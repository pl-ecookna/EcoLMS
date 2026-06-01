import { NextRequest, NextResponse } from "next/server"

import { buildLogout, readSession } from "@/lib/auth/logto"
import { getRequestOrigin } from "@/lib/auth/server"

export async function GET(request: NextRequest) {
  const origin = await getRequestOrigin()
  const secure = origin.startsWith("https://")
  const session = readSession(request.headers)
  const { clearRequestCookie, clearSessionCookie, logoutUrl } = await buildLogout({
    session,
    origin,
    secure,
  })

  const response = NextResponse.redirect(logoutUrl)
  response.headers.append("Set-Cookie", clearRequestCookie)
  response.headers.append("Set-Cookie", clearSessionCookie)
  return response
}
