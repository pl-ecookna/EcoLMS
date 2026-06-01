import { NextRequest, NextResponse } from "next/server"

import { startLogin } from "@/lib/auth/logto"
import { getRequestOrigin } from "@/lib/auth/server"

export async function GET(request: NextRequest) {
  const origin = await getRequestOrigin()
  const secure = origin.startsWith("https://")
  const returnTo = request.nextUrl.searchParams.get("returnTo") ?? "/"
  const { authorizeUrl, setCookie } = await startLogin({
    origin,
    secure,
    returnTo,
  })

  const response = NextResponse.redirect(authorizeUrl)
  response.headers.append("Set-Cookie", setCookie)
  return response
}
