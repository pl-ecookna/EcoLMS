import { headers } from "next/headers"

import type { ApiEnvelope } from "@/lib/ecolms-api"

async function getBaseUrl() {
  const requestHeaders = await headers()
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http"
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000"

  return `${protocol}://${host}`
}

export async function requestServerJson<T>(path: string): Promise<T> {
  const response = await fetch(`${await getBaseUrl()}${path}`, {
    cache: "no-store",
  })

  const text = await response.text()
  let payload: ApiEnvelope<T> | null = null
  if (text) {
    try {
      payload = JSON.parse(text) as ApiEnvelope<T>
    } catch {
      payload = null
    }
  }

  if (!response.ok) {
    const error = payload?.error ?? response.statusText
    throw new Error(error || text || "Не удалось выполнить запрос")
  }

  if (!payload || !payload.success) {
    throw new Error(payload?.error ?? "Некорректный ответ API")
  }

  return payload.data
}
