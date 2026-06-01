import { createHmac, randomBytes, webcrypto } from "node:crypto"

import { createRemoteJWKSet, jwtVerify } from "jose"

import type { AuthUser } from "@/lib/ecolms-api"

export const SESSION_COOKIE_NAME = "ecolms_auth_session"
const AUTH_REQUEST_COOKIE_NAME = "ecolms_auth_request"
const DEFAULT_ISSUER = "https://ecoauth.entechai.ru/oidc"
const DEFAULT_SCOPE = "openid profile email roles"
const REQUIRED_ROLES = new Set(["lms_admin", "lms_editor"])

type DiscoveryDocument = {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  end_session_endpoint?: string
}

let discoveryPromise: Promise<DiscoveryDocument> | null = null
let jwksPromise: ReturnType<typeof createRemoteJWKSet> | null = null

type SessionUser = AuthUser & {
  exp: number
  idToken: string
}

function getIssuer() {
  return (process.env.ECOLMS_LOGTO_ISSUER ?? DEFAULT_ISSUER).replace(/\/+$/, "")
}

function getClientId() {
  const clientId = process.env.ECOLMS_LOGTO_CLIENT_ID?.trim()
  if (!clientId) {
    throw new Error("Missing ECOLMS_LOGTO_CLIENT_ID")
  }
  return clientId
}

function getClientSecret() {
  const clientSecret = process.env.ECOLMS_LOGTO_CLIENT_SECRET?.trim()
  if (!clientSecret) {
    throw new Error("Missing ECOLMS_LOGTO_CLIENT_SECRET")
  }
  return clientSecret
}

function getScope() {
  return process.env.ECOLMS_LOGTO_SCOPE?.trim() || DEFAULT_SCOPE
}

function getRedirectUri(origin: string) {
  return process.env.ECOLMS_LOGTO_REDIRECT_URI?.trim() || `${origin}/api/auth/callback`
}

function getPostLogoutRedirectUri(origin: string) {
  return process.env.ECOLMS_LOGTO_POST_LOGOUT_REDIRECT_URI?.trim() || `${origin}/login`
}

function getSessionSecret() {
  return process.env.ECOLMS_SESSION_SECRET?.trim() || process.env.ECOLMS_INTERNAL_AUTH_SECRET?.trim() || getClientSecret()
}

function sanitizeReturnToPath(value: string | null | undefined) {
  const path = typeof value === "string" ? value.trim() : ""
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("://")) {
    return "/"
  }
  return path
}

function base64UrlEncode(input: Buffer | string) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input)
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function base64UrlDecode(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")
  return Buffer.from(base64, "base64")
}

function randomBase64Url(bytes = 32) {
  return base64UrlEncode(randomBytes(bytes))
}

async function sha256(input: string) {
  const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
  return base64UrlEncode(Buffer.from(digest))
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url")
}

function parseCookieHeader(cookieHeader: string | null | undefined) {
  const cookies = new Map<string, string>()
  if (!cookieHeader) return cookies

  for (const pair of cookieHeader.split(";")) {
    const separatorIndex = pair.indexOf("=")
    if (separatorIndex === -1) continue
    const key = pair.slice(0, separatorIndex).trim()
    const value = pair.slice(separatorIndex + 1).trim()
    if (key) {
      cookies.set(key, decodeURIComponent(value))
    }
  }

  return cookies
}

function createCookieString(name: string, value: string, options: { maxAge?: number; expires?: Date; path?: string; httpOnly?: boolean; sameSite?: "Lax" | "Strict" | "None"; secure?: boolean } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.trunc(options.maxAge)}`)
  if (options.expires instanceof Date) parts.push(`Expires=${options.expires.toUTCString()}`)
  parts.push(`Path=${options.path ?? "/"}`)
  if (options.httpOnly !== false) parts.push("HttpOnly")
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`)
  if (options.secure) parts.push("Secure")
  return parts.join("; ")
}

function readSignedCookie(headers: Headers | { cookie?: string | null }, cookieName: string, secret: string) {
  const rawHeader = headers instanceof Headers ? headers.get("cookie") : headers.cookie
  const cookies = parseCookieHeader(rawHeader)
  const raw = cookies.get(cookieName)
  if (!raw) return null

  const separatorIndex = raw.lastIndexOf(".")
  if (separatorIndex === -1) return null

  const payload = raw.slice(0, separatorIndex)
  const signature = raw.slice(separatorIndex + 1)
  if (sign(payload, secret) !== signature) {
    return null
  }

  try {
    return JSON.parse(base64UrlDecode(payload).toString("utf8"))
  } catch {
    return null
  }
}

function writeSignedCookie(name: string, payload: unknown, secret: string, options: Parameters<typeof createCookieString>[2] = {}) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const signature = sign(encodedPayload, secret)
  return createCookieString(name, `${encodedPayload}.${signature}`, options)
}

function clearCookie(name: string, options: { secure?: boolean } = {}) {
  return createCookieString(name, "", {
    maxAge: 0,
    expires: new Date(0),
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: options.secure,
  })
}

function normalizeRoles(claims: Record<string, unknown>) {
  const values = [claims.roles, claims.groups]
  const roles = new Set<string>()

  for (const value of values) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) {
          roles.add(item.trim())
        }
      }
      continue
    }
    if (typeof value === "string" && value.trim()) {
      roles.add(value.trim())
    }
  }

  return [...roles]
}

function pickAppRole(roles: string[]): AuthUser["role"] | null {
  if (roles.includes("lms_admin")) return "admin"
  if (roles.includes("lms_editor")) return "editor"
  return null
}

async function getDiscoveryDocument() {
  if (!discoveryPromise) {
    discoveryPromise = fetch(`${getIssuer()}/.well-known/openid-configuration`, {
      credentials: "omit",
      cache: "no-store",
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load Logto discovery document (${response.status})`)
      }
      return response.json()
    })
  }

  return discoveryPromise
}

async function getJwks() {
  if (!jwksPromise) {
    const discovery = await getDiscoveryDocument()
    jwksPromise = createRemoteJWKSet(new URL(discovery.jwks_uri))
  }
  return jwksPromise
}

function createAuthRequestCookie(payload: unknown, options: { secure?: boolean } = {}) {
  return writeSignedCookie(AUTH_REQUEST_COOKIE_NAME, payload, getSessionSecret(), {
    maxAge: 10 * 60,
    expires: new Date(Date.now() + 10 * 60 * 1000),
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: options.secure,
  })
}

function readAuthRequest(headers: Headers | { cookie?: string | null }) {
  return readSignedCookie(headers, AUTH_REQUEST_COOKIE_NAME, getSessionSecret()) as {
    state: string
    nonce: string
    codeVerifier: string
    returnTo: string
  } | null
}

export function clearSessionCookie(options: { secure?: boolean } = {}) {
  return clearCookie(SESSION_COOKIE_NAME, options)
}

export function clearAuthRequestCookie(options: { secure?: boolean } = {}) {
  return clearCookie(AUTH_REQUEST_COOKIE_NAME, options)
}

export function readSession(headers: Headers | { cookie?: string | null }) {
  const session = readSignedCookie(headers, SESSION_COOKIE_NAME, getSessionSecret()) as SessionUser | null
  if (!session || typeof session !== "object") {
    return null
  }
  if (!session.exp || Date.now() >= session.exp - 30_000) {
    return null
  }
  return session
}

export function createSessionCookie(session: SessionUser, options: { secure?: boolean } = {}) {
  const expires = new Date(session.exp)
  const maxAge = Math.max(0, Math.floor((session.exp - Date.now()) / 1000))
  return writeSignedCookie(SESSION_COOKIE_NAME, session, getSessionSecret(), {
    maxAge,
    expires,
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: options.secure,
  })
}

export async function startLogin({ origin, secure, returnTo = "/" }: { origin: string; secure: boolean; returnTo?: string }) {
  const discovery = await getDiscoveryDocument()
  const state = randomBase64Url(24)
  const nonce = randomBase64Url(24)
  const codeVerifier = randomBase64Url(48)
  const codeChallenge = await sha256(codeVerifier)
  const url = new URL(discovery.authorization_endpoint)

  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", getClientId())
  url.searchParams.set("redirect_uri", getRedirectUri(origin))
  url.searchParams.set("scope", getScope())
  url.searchParams.set("state", state)
  url.searchParams.set("nonce", nonce)
  url.searchParams.set("code_challenge", codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")

  return {
    authorizeUrl: url.toString(),
    setCookie: createAuthRequestCookie(
      {
        state,
        nonce,
        codeVerifier,
        returnTo: sanitizeReturnToPath(returnTo),
      },
      { secure },
    ),
  }
}

export async function completeLogin({
  headers,
  currentUrl,
  origin,
  secure,
}: {
  headers: Headers | { cookie?: string | null }
  currentUrl: URL
  origin: string
  secure: boolean
}) {
  const params = currentUrl.searchParams
  const error = params.get("error_description") ?? params.get("error")
  if (error) {
    throw new Error(error)
  }

  const code = params.get("code")
  const returnedState = params.get("state")
  if (!code || !returnedState) {
    throw new Error("Missing authorization response")
  }

  const request = readAuthRequest(headers)
  if (!request) {
    throw new Error("Missing stored PKCE request. Please try to sign in again.")
  }
  if (request.state !== returnedState) {
    throw new Error("Invalid authorization state")
  }

  const discovery = await getDiscoveryDocument()
  const tokenResponse = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: getClientId(),
      client_secret: getClientSecret(),
      code,
      redirect_uri: getRedirectUri(origin),
      code_verifier: request.codeVerifier,
    }),
    cache: "no-store",
  })

  if (!tokenResponse.ok) {
    throw new Error(`Token exchange failed (${tokenResponse.status})`)
  }

  const token = await tokenResponse.json()
  if (!token.id_token) {
    throw new Error("Token response is missing ID token")
  }

  const jwks = await getJwks()
  const { payload: claims } = await jwtVerify(token.id_token, jwks, {
    issuer: discovery.issuer,
    audience: getClientId(),
  })

  if (claims.nonce !== request.nonce) {
    throw new Error("Invalid token nonce")
  }
  if (!claims.sub || !claims.exp) {
    throw new Error("Token is missing required profile claims")
  }

  const roles = normalizeRoles(claims as Record<string, unknown>)
  const role = pickAppRole(roles)
  if (!role || !roles.some((item) => REQUIRED_ROLES.has(item))) {
    const accessError = new Error("У вас нет доступа к EcoLMS.")
    ;(accessError as Error & { code?: string }).code = "access_denied"
    throw accessError
  }

  const email =
    (typeof claims.email === "string" && claims.email.trim()) ||
    (typeof claims.preferred_username === "string" && claims.preferred_username.trim()) ||
    String(claims.sub)
  const name = (typeof claims.name === "string" && claims.name.trim()) || email || String(claims.sub)

  return {
    returnTo: sanitizeReturnToPath(request.returnTo),
    clearRequestCookie: clearAuthRequestCookie({ secure }),
    sessionCookie: createSessionCookie(
      {
        id: String(claims.sub),
        sub: String(claims.sub),
        email,
        name,
        role,
        roles,
        exp: claims.exp * 1000,
        idToken: token.id_token,
      } as SessionUser,
      { secure },
    ),
  }
}

export async function buildLogout({ session, origin, secure }: { session: SessionUser | null; origin: string; secure: boolean }) {
  const discovery = await getDiscoveryDocument()
  const logoutUrl = new URL(discovery.end_session_endpoint || getPostLogoutRedirectUri(origin))
  if (discovery.end_session_endpoint) {
    logoutUrl.searchParams.set("post_logout_redirect_uri", getPostLogoutRedirectUri(origin))
    if (session?.idToken) {
      logoutUrl.searchParams.set("id_token_hint", session.idToken)
    }
  }

  return {
    clearRequestCookie: clearAuthRequestCookie({ secure }),
    clearSessionCookie: clearSessionCookie({ secure }),
    logoutUrl: logoutUrl.toString(),
  }
}

export function getSessionUser(headers: Headers | { cookie?: string | null }): AuthUser | null {
  const session = readSession(headers)
  if (!session) {
    return null
  }
  return {
    id: session.id,
    email: session.email,
    name: session.name,
    role: session.role,
    roles: session.roles,
  }
}

export function buildInternalAuthHeaders(user: AuthUser) {
  const encodedEmail = encodeURIComponent(user.email)
  const encodedName = encodeURIComponent(user.name)
  const rolesValue = user.roles.join(",")
  const payload = [user.id, encodedEmail, encodedName, user.role, rolesValue].join("|")
  const signature = sign(payload, process.env.ECOLMS_INTERNAL_AUTH_SECRET?.trim() || getSessionSecret())

  return {
    "x-ecolms-auth-user-id": user.id,
    "x-ecolms-auth-email": encodedEmail,
    "x-ecolms-auth-name": encodedName,
    "x-ecolms-auth-role": user.role,
    "x-ecolms-auth-roles": rolesValue,
    "x-ecolms-auth-signature": signature,
  }
}
