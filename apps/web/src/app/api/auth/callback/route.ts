import { NextRequest, NextResponse } from "next/server"

import { completeLogin } from "@/lib/auth/logto"
import { getRequestOrigin } from "@/lib/auth/server"

function buildLoginErrorRedirect(origin: string, error: unknown) {
  const redirectPath =
    error instanceof Error && (error as Error & { code?: string }).code === "access_denied"
      ? "/forbidden"
      : `/login?error=${encodeURIComponent(error instanceof Error ? error.message : "Не удалось выполнить вход")}`
  return new URL(redirectPath, origin)
}

export async function GET(request: NextRequest) {
  const origin = await getRequestOrigin()
  const secure = origin.startsWith("https://")

  try {
    const result = await completeLogin({
      headers: request.headers,
      currentUrl: request.nextUrl,
      origin,
      secure,
    })

    const response = NextResponse.redirect(new URL(result.returnTo, origin))
    response.headers.append("Set-Cookie", result.clearRequestCookie)
    response.headers.append("Set-Cookie", result.sessionCookie)
    return response
  } catch (error) {
    const response = NextResponse.redirect(buildLoginErrorRedirect(origin, error))
    return response
  }
}
