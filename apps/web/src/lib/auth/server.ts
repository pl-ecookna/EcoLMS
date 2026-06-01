import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

import type { AuthUser } from "@/lib/ecolms-api"
import { getSessionUser } from "@/lib/auth/logto"

function getOriginFromHeaders(requestHeaders: Headers) {
  const forwardedProto = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim()
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim()
  const host = forwardedHost || requestHeaders.get("host") || "localhost:3000"
  const protocol = forwardedProto || "http"
  return `${protocol}://${host}`
}

export async function getRequestOrigin() {
  return getOriginFromHeaders(await headers())
}

export async function getOptionalAuthUser() {
  const cookieStore = await cookies()
  return getSessionUser({ cookie: cookieStore.toString() })
}

export async function requireAuthUser(returnTo = "/"): Promise<AuthUser> {
  const user = await getOptionalAuthUser()
  if (!user) {
    redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`)
  }
  return user
}

export async function requireAdminUser(returnTo = "/"): Promise<AuthUser> {
  const user = await requireAuthUser(returnTo)
  if (user.role !== "admin") {
    redirect("/forbidden")
  }
  return user
}
