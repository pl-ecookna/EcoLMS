import { Injectable } from "@nestjs/common"

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
    services: {
      api: ServiceState
      postgres: ServiceState
      redis: ServiceState
      openai: ServiceState
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

  private async checkOpenAI(): Promise<ServiceState> {
    const checkedAt = this.nowIso()
    const openAiKey = process.env.OPENAI_API_KEY?.trim()
    const openRouterKey = process.env.OPENROUTER_API_KEY?.trim()

    if (!openAiKey && !openRouterKey) {
      return {
        status: "unknown",
        details: "Ключ OpenAI/OpenRouter не задан",
        checkedAt,
      }
    }

    const target = openAiKey
      ? {
          url: "https://api.openai.com/v1/models",
          headers: { Authorization: `Bearer ${openAiKey}` },
          name: "OpenAI",
        }
      : {
          url: "https://openrouter.ai/api/v1/models",
          headers: { Authorization: `Bearer ${openRouterKey}` },
          name: "OpenRouter",
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
        return { status: "up", details: `${target.name} доступен`, checkedAt }
      }

      return {
        status: "degraded",
        details: `${target.name}: HTTP ${response.status}`,
        checkedAt,
      }
    } catch (error) {
      return {
        status: "down",
        details: error instanceof Error ? error.message : `${target.name} недоступен`,
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
        `select count(*)::text as count from processing_jobs where status = 'processing'`
      )
      const processingCount = Number(processingResult.rows[0]?.count ?? 0)

      const lastActivityResult = await this.db.query<{ last_activity: string | null }>(
        `
        select max(coalesce(finished_at, started_at, created_at))::text as last_activity
        from processing_jobs
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

    const [postgres, redis, openai, worker, transcriptionService] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
      this.checkOpenAI(),
      this.checkWorker(),
      this.checkTranscriptionService(),
    ])

    const storeHealth = await this.store.health()
    const stats = storeHealth.data

    const status = this.aggregateStatus([
      api,
      postgres,
      redis,
      openai,
      worker,
      transcriptionService,
    ])

    const snapshot: HealthSnapshot = {
      success: true,
      data: {
        status,
        service: "api",
        timestamp,
        services: {
          api,
          postgres,
          redis,
          openai,
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
