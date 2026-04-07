import { Injectable, Logger } from "@nestjs/common"
import net from "node:net"

export type ProcessingJobMessage = {
  jobId: string
  projectId: string
  stage: "source_compiled" | "course_outline" | "course_content" | "course_test"
  trigger: "start" | "approval" | "retry"
}

const JOB_QUEUE_KEY = "ecolms:processing-jobs"
const INTERNAL_REDIS_URL =
  "redis://default:0ttko0zmmp7klvsv@ecolms-lmsredis-czote9:6379"
const EXTERNAL_REDIS_URL =
  "redis://default:0ttko0zmmp7klvsv@46.173.20.149:6381"

function defaultRedisUrl() {
  return process.env.NODE_ENV === "production"
    ? INTERNAL_REDIS_URL
    : EXTERNAL_REDIS_URL
}

function normalizeRedisUrl(value: string | undefined) {
  if (!value) {
    return defaultRedisUrl()
  }

  if (
    value.includes("localhost") ||
    value.includes("127.0.0.1")
  ) {
    return defaultRedisUrl()
  }

  if (
    process.env.NODE_ENV !== "production" &&
    value.includes("ecolms-lmsredis-czote9")
  ) {
    return EXTERNAL_REDIS_URL
  }

  return value
}

function parseRedisUrl(redisUrl: string) {
  const url = new URL(redisUrl)
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
  }
}

function encodeCommand(parts: string[]) {
  const payload = [`*${parts.length}\r\n`]
  for (const part of parts) {
    const value = Buffer.from(part)
    payload.push(`$${value.length}\r\n`)
    payload.push(value.toString("utf8"))
    payload.push("\r\n")
  }
  return payload.join("")
}

function decodeOneResponse(buffer: string) {
  const prefix = buffer[0]
  if (!prefix) {
    return null
  }

  if (prefix === "+") {
    const end = buffer.indexOf("\r\n")
    if (end === -1) return null
    return { value: buffer.slice(1, end), rest: buffer.slice(end + 2) }
  }

  if (prefix === ":") {
    const end = buffer.indexOf("\r\n")
    if (end === -1) return null
    return { value: Number(buffer.slice(1, end)), rest: buffer.slice(end + 2) }
  }

  if (prefix === "$") {
    const end = buffer.indexOf("\r\n")
    if (end === -1) return null
    const length = Number(buffer.slice(1, end))
    if (length === -1) {
      return { value: null, rest: buffer.slice(end + 2) }
    }
    const start = end + 2
    const stop = start + length
    if (buffer.length < stop + 2) return null
    return { value: buffer.slice(start, stop), rest: buffer.slice(stop + 2) }
  }

  if (prefix === "*") {
    const end = buffer.indexOf("\r\n")
    if (end === -1) return null
    const count = Number(buffer.slice(1, end))
    if (count === -1) {
      return { value: null, rest: buffer.slice(end + 2) }
    }

    let cursor = end + 2
    const items: unknown[] = []
    for (let index = 0; index < count; index += 1) {
      const decoded = decodeOneResponse(buffer.slice(cursor))
      if (!decoded) return null
      items.push(decoded.value)
      cursor = buffer.length - decoded.rest.length
    }
    return { value: items, rest: buffer.slice(cursor) }
  }

  if (prefix === "-") {
    const end = buffer.indexOf("\r\n")
    if (end === -1) return null
    const message = buffer.slice(1, end)
    throw new Error(message)
  }

  return null
}

async function runRedisCommand(redisUrl: string, parts: string[]) {
  const { host, port } = parseRedisUrl(redisUrl)
  return new Promise<unknown>((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => {
      socket.write(encodeCommand(parts))
    })

    let buffer = ""

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      try {
        const decoded = decodeOneResponse(buffer)
        if (!decoded) {
          return
        }

        resolve(decoded.value)
        socket.end()
      } catch (error) {
        reject(error)
        socket.destroy()
      }
    })

    socket.on("error", (error) => {
      reject(error)
    })

    socket.on("close", () => {
      if (buffer.length === 0) {
        reject(new Error("Redis connection closed without response"))
      }
    })
  })
}

@Injectable()
export class RedisQueueService {
  private readonly logger = new Logger(RedisQueueService.name)
  private readonly redisUrl = normalizeRedisUrl(process.env.REDIS_URL)

  async enqueueProcessingJob(message: ProcessingJobMessage) {
    await runRedisCommand(this.redisUrl, [
      "LPUSH",
      JOB_QUEUE_KEY,
      JSON.stringify(message),
    ])
  }

  async ping() {
    try {
      return String(await runRedisCommand(this.redisUrl, ["PING"]))
    } catch (error) {
      this.logger.error(
        `Redis error: ${error instanceof Error ? error.message : String(error)}`
      )
      throw error
    }
  }
}
