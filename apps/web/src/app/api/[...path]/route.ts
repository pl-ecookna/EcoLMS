import type { NextRequest } from "next/server"

const UPSTREAM_BASE_URL =
  process.env.ECOLMS_API_BASE_URL ??
  (process.env.NODE_ENV === "production"
    ? "http://api:3001"
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
