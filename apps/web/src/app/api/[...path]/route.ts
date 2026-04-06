import type { NextRequest } from "next/server"

const DEFAULT_INTERNAL_API_URL =
  "http://app-calculate-open-source-alarm-cob2f6:3001"

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
      ? DEFAULT_INTERNAL_API_URL
      : "http://localhost:3001"
  }

  return value
}

const UPSTREAM_BASE_URL =
  normalizeBaseUrl(process.env.ECOLMS_API_BASE_URL) ??
  (process.env.NODE_ENV === "production"
    ? DEFAULT_INTERNAL_API_URL
    : "http://localhost:3001")

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path?: string[] }> }
) {
  const params = await context.params
  const path = params.path?.join("/") ?? ""
  const url = new URL(request.url)
  const upstreamUrl = new URL(`${UPSTREAM_BASE_URL.replace(/\/$/, "")}/api/${path}`)
  upstreamUrl.search = url.search

  const headers = new Headers(request.headers)
  headers.delete("host")

  const requestInit = {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    cache: "no-store",
  } as RequestInit & { duplex?: "half" }

  if (request.method !== "GET" && request.method !== "HEAD") {
    requestInit.duplex = "half"
  }

  const response = await fetch(upstreamUrl, requestInit)

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

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
export const OPTIONS = proxy
