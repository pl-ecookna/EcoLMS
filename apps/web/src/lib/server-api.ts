import { cookies } from "next/headers"

import type { ApiEnvelope } from "@/lib/ecolms-api"
import { buildInternalAuthHeaders, getSessionUser } from "@/lib/auth/logto"

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

export async function requestServerJson<T>(path: string): Promise<T> {
  const requestCookies = await cookies()
  const user = getSessionUser({ cookie: requestCookies.toString() })
  if (!user) {
    throw new Error("Требуется вход в EcoLMS")
  }

  const headers = new Headers({
    accept: "application/json",
    ...buildInternalAuthHeaders(user),
  })

  let lastNetworkError: unknown = null
  let lastResponse: Response | null = null

  for (const baseUrl of UPSTREAM_BASE_URLS) {
    const upstreamUrl = new URL(`${baseUrl.replace(/\/$/, "")}${path}`)

    try {
      const response = await fetch(upstreamUrl, {
        cache: "no-store",
        headers,
      })

      lastResponse = response
      if (response.status < 500) {
        return parseApiResponse<T>(response)
      }
    } catch (error) {
      lastNetworkError = error
    }
  }

  if (lastResponse) {
    return parseApiResponse<T>(lastResponse)
  }

  throw new Error(
    lastNetworkError instanceof Error
      ? lastNetworkError.message
      : "Не удалось выполнить запрос"
  )
}

async function parseApiResponse<T>(response: Response): Promise<T> {
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
