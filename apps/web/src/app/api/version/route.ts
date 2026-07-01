import { NextResponse } from "next/server"

import { APP_BUILD_ID } from "@/lib/build-info"

export const dynamic = "force-dynamic"
export const revalidate = 0

export function GET() {
  return NextResponse.json(
    { buildId: APP_BUILD_ID },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  )
}
