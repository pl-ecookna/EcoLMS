import type { NextRequest } from "next/server"

export const runtime = "nodejs"

async function proxy(request: NextRequest) {
  const targetUrl = request.headers.get("x-target-url")
  if (!targetUrl) {
    return new Response(
      JSON.stringify({ success: false, data: null, error: "Missing target url" }),
      {
        status: 400,
        headers: {
          "content-type": "application/json",
        },
      }
    )
  }

  const body = Buffer.from(await request.arrayBuffer())
  const response = await fetch(targetUrl, {
    method: "PUT",
    body,
    cache: "no-store",
  } as RequestInit & { duplex?: "half" })

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

export const PUT = proxy
