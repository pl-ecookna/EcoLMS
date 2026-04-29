import type { NextRequest } from "next/server"

const INTERNAL_API_URLS = [
  "http://app-calculate-open-source-alarm-cob2f6:3001",
  "http://api:3001",
] as const

function normalizeBaseUrl(value: string | undefined) {
  if (!value) {
    return undefined
  }

  if (
    value.includes("api:3001") ||
    value.includes("localhost:3001") ||
    value.includes("127.0.0.1:3001")
  ) {
    return process.env.NODE_ENV === "production"
      ? INTERNAL_API_URLS[0]
      : "http://localhost:3101"
  }

  return value
}

const UPSTREAM_BASE_URLS =
  process.env.NODE_ENV === "production"
    ? [
        normalizeBaseUrl(process.env.ECOLMS_API_BASE_URL),
        ...INTERNAL_API_URLS,
      ].filter((value): value is string => Boolean(value))
    : [
        normalizeBaseUrl(process.env.ECOLMS_API_BASE_URL) ??
          "http://localhost:3101",
      ]

const DEFAULT_UPSTREAM_TIMEOUT_MS = 8000
const configuredTimeout = Number(process.env.ECOLMS_UPSTREAM_TIMEOUT_MS ?? "")
const UPSTREAM_TIMEOUT_MS =
  Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : DEFAULT_UPSTREAM_TIMEOUT_MS

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path?: string[] }> }
) {
  const params = await context.params
  const path = params.path?.join("/") ?? ""
  const url = new URL(request.url)
  const headers = new Headers(request.headers)
  headers.delete("host")
  headers.delete("content-length")

  const requestBody =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer()

  let lastNetworkError: unknown = null
  let lastResponse: Response | null = null

  for (const baseUrl of UPSTREAM_BASE_URLS) {
    const upstreamUrl = new URL(`${baseUrl.replace(/\/$/, "")}/api/${path}`)
    upstreamUrl.search = url.search

    const requestInit = {
      method: request.method,
      headers,
      body: requestBody,
      cache: "no-store",
    } as RequestInit & { duplex?: "half" }

    if (request.method !== "GET" && request.method !== "HEAD") {
      requestInit.duplex = "half"
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
    requestInit.signal = controller.signal

    try {
      const response = await fetch(upstreamUrl, requestInit)
      lastResponse = response

      if (response.status < 500) {
        const responseHeaders = new Headers(response.headers)
        responseHeaders.delete("content-encoding")
        responseHeaders.delete("transfer-encoding")
        responseHeaders.delete("content-length")

        return new Response(await response.arrayBuffer(), {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
        })
      }
    } catch (error) {
      lastNetworkError = error
    } finally {
      clearTimeout(timeout)
    }
  }

  if (lastResponse) {
    const responseHeaders = new Headers(lastResponse.headers)
    responseHeaders.delete("content-encoding")
    responseHeaders.delete("transfer-encoding")
    responseHeaders.delete("content-length")

    return new Response(await lastResponse.arrayBuffer(), {
      status: lastResponse.status,
      statusText: lastResponse.statusText,
      headers: responseHeaders,
    })
  }

  return new Response(
    JSON.stringify({
      success: false,
      data: null,
      error:
        lastNetworkError instanceof Error
          ? lastNetworkError.name === "AbortError"
            ? `Upstream API timeout after ${UPSTREAM_TIMEOUT_MS}ms`
            : lastNetworkError.message
          : "Upstream API is unavailable",
    }),
    {
      status: 502,
      headers: {
        "content-type": "application/json",
      },
    }
  )
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
export const OPTIONS = proxy
