import { Injectable } from "@nestjs/common"
import { readFile } from "node:fs/promises"
import { Agent as HttpsAgent, request as httpsRequest } from "node:https"

import { PostgresService } from "./db/postgres.service"
import { RedisQueueService } from "./redis/redis.service"
import { EcolmsStore } from "./store/ecolms.store"

type ServiceStatus = "up" | "down" | "degraded" | "unknown"

type ServiceState = {
  status: ServiceStatus
  details: string
  checkedAt: string
}

type HealthSnapshot = {
  success: true
  data: {
    status: ServiceStatus
    service: "api"
    timestamp: string
    speechProviderName: string
    services: {
      api: ServiceState
      postgres: ServiceState
      redis: ServiceState
      llm: ServiceState
      speechProvider: ServiceState
      worker: ServiceState
      transcriptionService: ServiceState
    }
    stats: {
      projects: number
      uploads: number
    }
  }
  error: null
}

const HEALTH_CACHE_TTL_MS = 15_000

@Injectable()
export class AppService {
  private cachedHealth: HealthSnapshot | null = null
  private cachedAt = 0

  constructor(
    private readonly store: EcolmsStore,
    private readonly db: PostgresService,
    private readonly queue: RedisQueueService
  ) {}

  private nowIso() {
    return new Date().toISOString()
  }

  private async runWithTimeout(
    fn: () => Promise<unknown>,
    timeoutMs = 5_000
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout after ${timeoutMs}ms`))
      }, timeoutMs)

      fn()
        .then((result) => {
          clearTimeout(timeout)
          resolve(result)
        })
        .catch((error) => {
          clearTimeout(timeout)
          reject(error)
        })
    })
  }

  private hasBillingIssue(details: string) {
    const normalized = details.toLowerCase()
    return [
      "insufficient_quota",
      "insufficient quota",
      "insufficient funds",
      "out of credits",
      "payment required",
      "billing",
      "quota exceeded",
      "not enough credits",
      "credit balance",
      "balance",
      "недостаточно средств",
      "недостаточно денег",
      "недостаточно кредитов",
      "исчерпан лимит",
      "квота",
      "quota",
      "402",
    ].some((pattern) => normalized.includes(pattern))
  }

  private formatBillingDetails(provider: string, details: string) {
    if (this.hasBillingIssue(details)) {
      return `${provider}: недостаточно средств или исчерпана квота`
    }
    return details
  }

  private async readResponseTextSafe(response: Response) {
    try {
      return (await response.text()).trim()
    } catch {
      return ""
    }
  }

  private firstDefinedEnv(...names: string[]) {
    for (const name of names) {
      const value = process.env[name]?.trim()
      if (value) {
        return value
      }
    }
    return ""
  }

  private normalizeBasicAuthValue(value: string) {
    let candidate = value.trim()
    if (!candidate) {
      return ""
    }
    if (candidate.toLowerCase().startsWith("basic ")) {
      candidate = candidate.slice(6).trim()
    }
    if (candidate.includes(":")) {
      return Buffer.from(candidate, "utf-8").toString("base64")
    }
    return candidate
  }

  private resolveSaluteSpeechAuthConfig() {
    const authKey = this.normalizeBasicAuthValue(
      this.firstDefinedEnv("SALUTESPEECH_AUTH_KEY", "SBER_AUTH_KEY")
    )
    const clientId = this.firstDefinedEnv("SALUTESPEECH_CLIENT_ID", "SBER_CLIENT_ID")
    const clientSecret = this.firstDefinedEnv(
      "SALUTESPEECH_CLIENT_SECRET",
      "SBER_CLIENT_SECRET"
    )
    const oauthUrl = this.firstDefinedEnv("SALUTESPEECH_OAUTH_URL", "SBER_OAUTH_URL")
    const scope =
      this.firstDefinedEnv("SALUTESPEECH_SCOPE", "SBER_SCOPE") || "SALUTE_SPEECH_PERS"
    const caCertPath = this.firstDefinedEnv(
      "SALUTESPEECH_CA_CERT_PATH",
      "SALUTESPEECH_CA_CERT",
      "SBER_CA_CERT_PATH"
    )

    const resolvedAuthKey =
      authKey ||
      (clientId && clientSecret
        ? Buffer.from(`${clientId}:${clientSecret}`, "utf-8").toString("base64")
        : "")

    return {
      authKey: resolvedAuthKey,
      oauthUrl,
      scope,
      caCertPath,
      hasCredentials: Boolean(resolvedAuthKey || clientId || clientSecret),
    }
  }

  private resolveMeetingTranscriptionProvider() {
    const provider = (process.env.MEETING_TRANSCRIPTION_PROVIDER || "assemblyai")
      .trim()
      .toLowerCase()
    return provider === "salutespeech" ? "salutespeech" : "assemblyai"
  }

  private meetingTranscriptionProviderName() {
    return this.resolveMeetingTranscriptionProvider() === "salutespeech"
      ? "SaluteSpeech"
      : "AssemblyAI"
  }

  private async checkPostgres(): Promise<ServiceState> {
    const checkedAt = this.nowIso()
    try {
      await this.db.query("select 1")
      return { status: "up", details: "Соединение установлено", checkedAt }
    } catch (error) {
      return {
        status: "down",
        details: error instanceof Error ? error.message : "Ошибка подключения",
        checkedAt,
      }
    }
  }

  private async checkRedis(): Promise<ServiceState> {
    const checkedAt = this.nowIso()
    try {
      const pong = await this.queue.ping()
      return {
        status: pong.toUpperCase().includes("PONG") ? "up" : "degraded",
        details: `Ответ: ${pong}`,
        checkedAt,
      }
    } catch (error) {
      return {
        status: "down",
        details: error instanceof Error ? error.message : "Ошибка подключения",
        checkedAt,
      }
    }
  }

  private async checkLlmProvider(): Promise<ServiceState> {
    const checkedAt = this.nowIso()
    const provider = (process.env.LLM_PRIMARY_PROVIDER || "openai").trim().toLowerCase()
    const openAiKey = process.env.OPENAI_API_KEY?.trim()
    const openRouterKey = process.env.OPENROUTER_API_KEY?.trim()

    const target =
      provider === "openrouter"
        ? openRouterKey
          ? {
              url: "https://openrouter.ai/api/v1/models",
              headers: { Authorization: `Bearer ${openRouterKey}` },
              name: "OpenRouter",
            }
          : null
        : openAiKey
          ? {
              url: "https://api.openai.com/v1/models",
              headers: { Authorization: `Bearer ${openAiKey}` },
              name: "OpenAI",
            }
          : null

    if (!target) {
      return {
        status: "unknown",
        details:
          provider === "openrouter"
            ? "Выбран OpenRouter, но OPENROUTER_API_KEY не задан"
            : "Выбран OpenAI, но OPENAI_API_KEY не задан",
        checkedAt,
      }
    }

    try {
      const response = (await this.runWithTimeout(
        () =>
          fetch(target.url, {
            headers: target.headers,
          }),
        5_000
      )) as Response

      if (response.ok) {
        const quotaProbeUrl =
          target.name === "OpenRouter"
            ? "https://openrouter.ai/api/v1/chat/completions"
            : "https://api.openai.com/v1/chat/completions"

        try {
          const probeResponse = (await this.runWithTimeout(
            () =>
              fetch(quotaProbeUrl, {
                method: "POST",
                headers: {
                  ...target.headers,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  model: "gpt-4o-mini",
                  messages: [{ role: "user", content: "ping" }],
                  max_tokens: 1,
                }),
              }),
            10_000
          )) as Response

          if (probeResponse.ok) {
            return {
              status: "up",
              details: `${target.name} доступен. Ключ рабочий, квота в норме.`,
              checkedAt,
            }
          }

          const rawBody = await this.readResponseTextSafe(probeResponse)
          const probeDetails = this.formatBillingDetails(target.name, rawBody || `HTTP ${probeResponse.status}`)

          if (this.hasBillingIssue(probeDetails)) {
            return {
              status: "down",
              details: probeDetails,
              checkedAt,
            }
          }

          return {
            status: "degraded",
            details: probeDetails,
            checkedAt,
          }
        } catch {
          return {
            status: "up",
            details: `${target.name} доступен. Проверка квоты не завершена (timeout).`,
            checkedAt,
          }
        }
      }

      const rawDetails = await this.readResponseTextSafe(response)
      const details = this.formatBillingDetails(
        target.name,
        rawDetails || `HTTP ${response.status}`
      )

      return {
        status: this.hasBillingIssue(details) ? "down" : "degraded",
        details,
        checkedAt,
      }
    } catch (error) {
      const details =
        error instanceof Error ? this.formatBillingDetails(target.name, error.message) : `${target.name} недоступен`
      return {
        status: this.hasBillingIssue(details) ? "down" : "down",
        details,
        checkedAt,
      }
    }
  }

  private async requestSaluteSpeechOAuth(
    url: string,
    headers: Record<string, string>,
    body: string,
    timeoutMs: number,
    caCertPath: string
  ): Promise<{ statusCode: number; body: string }> {
    const ca = caCertPath ? await readFile(caCertPath, "utf-8") : undefined

    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        url,
        {
          method: "POST",
          headers,
          agent: new HttpsAgent({
            ca,
            rejectUnauthorized: true,
          }),
        },
        (response) => {
          const chunks: Buffer[] = []
          response.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          })
          response.on("end", () => {
            resolve({
              statusCode: response.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf-8"),
            })
          })
        }
      )

      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`Timeout after ${timeoutMs}ms`))
      })
      req.on("error", reject)
      req.write(body)
      req.end()
    })
  }

  private async checkSaluteSpeech(): Promise<ServiceState> {
    const checkedAt = this.nowIso()
    const { authKey, oauthUrl, scope, caCertPath } = this.resolveSaluteSpeechAuthConfig()

    if (!authKey || !oauthUrl) {
      return {
        status: "unknown",
        details: "SaluteSpeech не настроен: отсутствует OAuth-конфигурация",
        checkedAt,
      }
    }

    try {
      const response = await this.runWithTimeout(
        () =>
          this.requestSaluteSpeechOAuth(
            oauthUrl,
            {
              Authorization: `Basic ${authKey}`,
              RqUID: crypto.randomUUID(),
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
            },
            `scope=${encodeURIComponent(scope)}`,
            5_000,
            caCertPath
          ),
        6_000
      )
      const { statusCode, body } = response as { statusCode: number; body: string }
      if (statusCode >= 200 && statusCode < 300) {
        return {
          status: "up",
          details: "SaluteSpeech доступен. Баланс заранее не проверяется публичным API.",
          checkedAt,
        }
      }
      const details = this.formatBillingDetails(
        "SaluteSpeech",
        body || `HTTP ${statusCode}`
      )
      return {
        status: this.hasBillingIssue(details) ? "down" : "degraded",
        details,
        checkedAt,
      }
    } catch (error) {
      const details =
        error instanceof Error
          ? this.formatBillingDetails("SaluteSpeech", error.message)
          : "SaluteSpeech недоступен"
      return {
        status: this.hasBillingIssue(details) ? "down" : "down",
        details,
        checkedAt,
      }
    }
  }

  private async checkAssemblyAI(): Promise<ServiceState> {
    const checkedAt = this.nowIso()
    const apiKey = process.env.ASSEMBLYAI_API_KEY?.trim()
    const baseUrl = (process.env.ASSEMBLYAI_BASE_URL || "https://api.eu.assemblyai.com")
      .trim()
      .replace(/\/$/, "")

    if (!apiKey) {
      return {
        status: "unknown",
        details: "AssemblyAI не настроен: отсутствует API key",
        checkedAt,
      }
    }

    try {
      const response = (await this.runWithTimeout(
        () =>
          fetch(`${baseUrl}/v2/transcript?limit=1`, {
            headers: {
              Authorization: apiKey,
              Accept: "application/json",
            },
          }),
        5_000
      )) as Response

      if (response.ok) {
        return {
          status: "up",
          details: "AssemblyAI доступен. Проверка списка транскриптов выполнена успешно.",
          checkedAt,
        }
      }

      const rawDetails = await this.readResponseTextSafe(response)
      const details = this.formatBillingDetails(
        "AssemblyAI",
        rawDetails || `HTTP ${response.status}`
      )

      return {
        status:
          response.status === 401 || response.status === 403
            ? "down"
            : this.hasBillingIssue(details)
              ? "down"
              : "degraded",
        details,
        checkedAt,
      }
    } catch (error) {
      const details =
        error instanceof Error ? this.formatBillingDetails("AssemblyAI", error.message) : "AssemblyAI недоступен"
      return {
        status: this.hasBillingIssue(details) ? "down" : "down",
        details,
        checkedAt,
      }
    }
  }

  private async checkTranscriptionService(): Promise<ServiceState> {
    const checkedAt = this.nowIso()
    const base = (process.env.TRANSCRIPTION_SERVICE_URL || "http://localhost:3002").replace(
      /\/$/,
      ""
    )

    try {
      const response = (await this.runWithTimeout(
        () => fetch(`${base}/health`),
        4_000
      )) as Response
      if (response.ok) {
        return { status: "up", details: "Сервис отвечает", checkedAt }
      }
      return {
        status: "degraded",
        details: `HTTP ${response.status}`,
        checkedAt,
      }
    } catch (error) {
      return {
        status: "down",
        details: error instanceof Error ? error.message : "Сервис недоступен",
        checkedAt,
      }
    }
  }

  private async checkWorker(): Promise<ServiceState> {
    const checkedAt = this.nowIso()
    try {
      const processingResult = await this.db.query<{ count: string }>(
        `
        select count(*)::text as count
        from (
          select 1
          from processing_jobs
          where status = 'processing'
          union all
          select 1
          from meeting_jobs
          where status = 'processing'
        ) jobs
        `
      )
      const processingCount = Number(processingResult.rows[0]?.count ?? 0)

      const lastActivityResult = await this.db.query<{ last_activity: string | null }>(
        `
        select max(last_activity)::text as last_activity
        from (
          select max(coalesce(finished_at, started_at, created_at)) as last_activity
          from processing_jobs
          union all
          select max(coalesce(finished_at, started_at, created_at)) as last_activity
          from meeting_jobs
        ) activity
        `
      )
      const lastActivityRaw = lastActivityResult.rows[0]?.last_activity
      const lastActivityMs = lastActivityRaw ? Date.parse(lastActivityRaw) : NaN
      const hasRecentActivity =
        Number.isFinite(lastActivityMs) && Date.now() - lastActivityMs < 30 * 60_000

      if (processingCount > 0) {
        return {
          status: hasRecentActivity ? "up" : "degraded",
          details: hasRecentActivity
            ? "Есть активные задачи обработки"
            : "Есть активные задачи, но нет недавней активности",
          checkedAt,
        }
      }

      if (hasRecentActivity) {
        return { status: "up", details: "Недавно обрабатывал задачи", checkedAt }
      }

      return { status: "unknown", details: "Нет недавней активности worker", checkedAt }
    } catch (error) {
      return {
        status: "degraded",
        details: error instanceof Error ? error.message : "Не удалось проверить worker",
        checkedAt,
      }
    }
  }

  private aggregateStatus(states: ServiceState[]): ServiceStatus {
    if (states.some((state) => state.status === "down")) {
      return "down"
    }
    if (states.some((state) => state.status === "degraded")) {
      return "degraded"
    }
    if (states.every((state) => state.status === "unknown")) {
      return "unknown"
    }
    if (states.some((state) => state.status === "up")) {
      return "up"
    }
    return "unknown"
  }

  async health() {
    const now = Date.now()
    if (this.cachedHealth && now - this.cachedAt < HEALTH_CACHE_TTL_MS) {
      return this.cachedHealth
    }

    const timestamp = this.nowIso()
    const api: ServiceState = {
      status: "up",
      details: "API доступен",
      checkedAt: timestamp,
    }

    const [postgres, redis, llm, speechProvider, worker, transcriptionService] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
      this.checkLlmProvider(),
      this.resolveMeetingTranscriptionProvider() === "salutespeech"
        ? this.checkSaluteSpeech()
        : this.checkAssemblyAI(),
      this.checkWorker(),
      this.checkTranscriptionService(),
    ])

    const storeHealth = await this.store.health()
    const stats = storeHealth.data

    const status = this.aggregateStatus([
      api,
      postgres,
      redis,
      llm,
      speechProvider,
      worker,
      transcriptionService,
    ])

    const snapshot: HealthSnapshot = {
      success: true,
      data: {
        status,
        service: "api",
        timestamp,
        speechProviderName: this.meetingTranscriptionProviderName(),
        services: {
          api,
          postgres,
          redis,
          llm,
          speechProvider,
          worker,
          transcriptionService,
        },
        stats: {
          projects: Number(stats.projects ?? 0),
          uploads: Number(stats.uploads ?? 0),
        },
      },
      error: null,
    }

    this.cachedHealth = snapshot
    this.cachedAt = now
    return snapshot
  }
}
