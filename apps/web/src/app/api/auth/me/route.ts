import { NextRequest, NextResponse } from "next/server"

import { getSessionUser } from "@/lib/auth/logto"

export async function GET(request: NextRequest) {
  return NextResponse.json({
    user: getSessionUser(request.headers),
  })
}
