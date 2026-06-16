import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common"
import { randomUUID } from "node:crypto"

import { PostgresService } from "../db/postgres.service"
import { RedisQueueService } from "../redis/redis.service"
import { createS3HeadObjectPresignedUrl, createS3UploadPartPresignedUrl } from "../s3/s3-presign"
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  type CompletedPart,
} from "../s3/s3-multipart"

const DEFAULT_S3_ENDPOINT = "https://s3.ru1.storage.beget.cloud"
const DEFAULT_S3_BUCKET = "1bf1b61c108f-ecolms"
const DEFAULT_S3_REGION = "ru1"
const MAX_MEETING_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024

export const meetingStageOrder = [
  "audio_prepared",
  "transcript_compiled",
  "meeting_summary",
  "meeting_protocol",
  "meeting_actions",
] as const

export type MeetingStageId = (typeof meetingStageOrder)[number]
export type MeetingStatus = "draft" | "uploaded" | "processing" | "completed" | "failed"
export type JobStatus = "queued" | "processing" | "done" | "failed"
export type UploadStatus = "initiated" | "uploading" | "completed" | "aborted"
export type ArtifactFormat = "md" | "json"
export type MeetingArtifactStage =
  | "transcript_compiled"
  | "meeting_summary"
  | "meeting_protocol"
  | "meeting_actions"

export interface MeetingSourceFileRecord {
  id: string
  meetingId: string
  originalName: string
  mimeType: string
  sizeBytes: number
  storageKey: string
  uploadStatus: UploadStatus
  processingStatus: JobStatus | "pending"
  durationSeconds: number | null
  audioStorageKey: string | null
  audioMimeType: string | null
  createdAt: string
}

export interface MeetingJobRecord {
  id: string
  meetingId: string
  stage: MeetingStageId
  status: JobStatus
  payloadJson: Record<string, unknown>
  resultJson: Record<string, unknown> | null
  errorText: string | null
  startedAt: string | null
  processingHeartbeatAt: string | null
  finishedAt: string | null
  createdAt: string
}

export interface MeetingSpeakerRecord {
  id: string
  meetingId: string
  speakerLabel: string
  displayName: string
  isUserEdited: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface MeetingSpeakerSegmentRecord {
  id: number
  meetingId: string
  speakerId: string | null
  speakerLabel: string
  displayName: string
  startMs: number
  endMs: number
  text: string
  confidence: number | null
  providerPayloadJson: Record<string, unknown>
  createdAt: string
}

export interface MeetingArtifactRecord {
  id: string
  meetingId: string
  stage: MeetingArtifactStage
  format: ArtifactFormat
  contentMd: string
  contentJson: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface MeetingProcessingMetrics {
  actualSeconds: number | null
  estimatedSeconds: number | null
  estimationSampleSize: number
}

export interface MeetingRecord {
  id: string
  title: string
  description: string
  status: MeetingStatus
  language: "ru"
  durationSeconds: number | null
  speakersCount: number
  processingStartedAt: string | null
  processingFinishedAt: string | null
  errorText: string | null
  processingMetrics: MeetingProcessingMetrics
  createdAt: string
  updatedAt: string
}

export interface MeetingListRecord extends MeetingRecord {
  sourceFile: MeetingSourceFileRecord | null
}

export interface MeetingDetailRecord extends MeetingRecord {
  sourceFile: MeetingSourceFileRecord | null
  speakers: MeetingSpeakerRecord[]
  segments: MeetingSpeakerSegmentRecord[]
  jobs: MeetingJobRecord[]
  artifacts: MeetingArtifactRecord[]
}

function nowIso() {
  return new Date().toISOString()
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) {
    return fallback
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }

  return value as T
}

function mapMeetingRow(row: Record<string, unknown>): MeetingRecord {
  const processingStartedAt = (row.processing_started_at as string | null) ?? null
  const processingFinishedAt = (row.processing_finished_at as string | null) ?? null
  return {
    id: String(row.id),
    title: String(row.title),
    description: String(row.description ?? ""),
    status: String(row.status) as MeetingStatus,
    language: "ru",
    durationSeconds:
      row.duration_seconds == null ? null : Number(row.duration_seconds),
    speakersCount: Number(row.speakers_count ?? 0),
    processingStartedAt,
    processingFinishedAt,
    errorText: (row.error_text as string | null) ?? null,
    processingMetrics: {
      actualSeconds: processingDurationSeconds(processingStartedAt, processingFinishedAt),
      estimatedSeconds: null,
      estimationSampleSize: 0,
    },
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function mapSourceFileRow(row: Record<string, unknown>): MeetingSourceFileRecord {
  return {
    id: String(row.id),
    meetingId: String(row.meeting_id),
    originalName: String(row.original_name),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    storageKey: String(row.storage_key),
    uploadStatus: String(row.upload_status) as UploadStatus,
    processingStatus: String(row.processing_status) as JobStatus | "pending",
    durationSeconds:
      row.duration_seconds == null ? null : Number(row.duration_seconds),
    audioStorageKey: (row.audio_storage_key as string | null) ?? null,
    audioMimeType: (row.audio_mime_type as string | null) ?? null,
    createdAt: String(row.created_at),
  }
}

function mapJobRow(row: Record<string, unknown>): MeetingJobRecord {
  return {
    id: String(row.id),
    meetingId: String(row.meeting_id),
    stage: String(row.stage) as MeetingStageId,
    status: String(row.status) as JobStatus,
    payloadJson: parseJson<Record<string, unknown>>(row.payload_json, {}),
    resultJson: parseJson<Record<string, unknown> | null>(row.result_json, null),
    errorText: (row.error_text as string | null) ?? null,
    startedAt: (row.started_at as string | null) ?? null,
    processingHeartbeatAt:
      (row.processing_heartbeat_at as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
    createdAt: String(row.created_at),
  }
}

function mapSpeakerRow(row: Record<string, unknown>): MeetingSpeakerRecord {
  return {
    id: String(row.id),
    meetingId: String(row.meeting_id),
    speakerLabel: String(row.speaker_label),
    displayName: String(row.display_name),
    isUserEdited: Boolean(row.is_user_edited),
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function mapArtifactRow(row: Record<string, unknown>): MeetingArtifactRecord {
  return {
    id: String(row.id),
    meetingId: String(row.meeting_id),
    stage: String(row.stage) as MeetingArtifactStage,
    format: String(row.format) as ArtifactFormat,
    contentMd: String(row.content_md ?? ""),
    contentJson: parseJson<Record<string, unknown>>(row.content_json, {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function buildActionsJson(contentMd: string) {
  return {
    decisions: [],
    actionItems: [],
    openQuestions: [],
    markdown: contentMd,
  }
}

function timeOf(value: string | null | undefined) {
  if (!value) {
    return 0
  }
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

function processingDurationSeconds(
  startedAt: string | null | undefined,
  finishedAt: string | null | undefined
) {
  const started = timeOf(startedAt)
  const finished = timeOf(finishedAt)
  if (started === 0 || finished === 0 || finished <= started) {
    return null
  }
  return Math.round((finished - started) / 1000)
}

function median(values: number[]) {
  if (values.length === 0) {
    return null
  }
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2
  }
  return sorted[middle]
}

function artifactForStage(
  artifacts: MeetingArtifactRecord[],
  stage: MeetingArtifactStage
) {
  return artifacts.find((artifact) => artifact.stage === stage && artifact.format === "md")
}

function hasMeetingArtifactOutput(
  artifacts: MeetingArtifactRecord[],
  stage: MeetingArtifactStage
) {
  const artifact = artifactForStage(artifacts, stage)
  return Boolean(artifact?.contentMd?.trim())
}

function meetingArtifactUpdatedAt(
  artifacts: MeetingArtifactRecord[],
  stage: MeetingArtifactStage
) {
  return timeOf(artifactForStage(artifacts, stage)?.updatedAt)
}

function hasEffectiveActiveJob(
  jobs: MeetingJobRecord[],
  artifacts: MeetingArtifactRecord[],
  stage: MeetingStageId
) {
  const job = [...jobs]
    .filter((item) => item.stage === stage)
    .sort((left, right) => timeOf(right.createdAt) - timeOf(left.createdAt))[0]
  if (!job || (job.status !== "queued" && job.status !== "processing")) {
    return false
  }
  if (stage === "audio_prepared") {
    return true
  }

  const artifactStage = stage as MeetingArtifactStage
  const hasOutput = hasMeetingArtifactOutput(artifacts, artifactStage)
  if (job.status === "queued") {
    return !hasOutput
  }

  return timeOf(job.createdAt) > meetingArtifactUpdatedAt(artifacts, artifactStage)
}

function shouldMarkMeetingCompleted(input: {
  meeting: MeetingRecord
  sourceFile: MeetingSourceFileRecord | null
  jobs: MeetingJobRecord[]
  artifacts: MeetingArtifactRecord[]
}) {
  if (input.meeting.status !== "processing" && input.meeting.status !== "uploaded") {
    return false
  }

  const requiredArtifacts: MeetingArtifactStage[] = [
    "transcript_compiled",
    "meeting_summary",
    "meeting_protocol",
    "meeting_actions",
  ]
  const hasAllOutputs =
    input.sourceFile?.processingStatus === "done" &&
    requiredArtifacts.every((stage) =>
      hasMeetingArtifactOutput(input.artifacts, stage)
    )

  if (!hasAllOutputs) {
    return false
  }

  return !meetingStageOrder.some((stage) =>
    hasEffectiveActiveJob(input.jobs, input.artifacts, stage)
  )
}

function mapSegmentRow(
  row: Record<string, unknown>,
  speakersById: Map<string, MeetingSpeakerRecord>
): MeetingSpeakerSegmentRecord {
  const speakerId = (row.speaker_id as string | null) ?? null
  const speaker = speakerId ? speakersById.get(speakerId) ?? null : null
  return {
    id: Number(row.id),
    meetingId: String(row.meeting_id),
    speakerId,
    speakerLabel: String(row.speaker_label),
    displayName: speaker?.displayName ?? String(row.speaker_label),
    startMs: Number(row.start_ms),
    endMs: Number(row.end_ms),
    text: String(row.text ?? ""),
    confidence:
      row.confidence == null ? null : Number(row.confidence),
    providerPayloadJson: parseJson<Record<string, unknown>>(
      row.provider_payload_json,
      {}
    ),
    createdAt: String(row.created_at),
  }
}

function makeMeetingId() {
  return `meet-${randomUUID().slice(0, 8)}`
}

function meetingJobStaleTimeoutSeconds() {
  const parsed = Number(process.env.MEETING_JOB_STALE_TIMEOUT_SECONDS ?? "3600")
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3600
}

function staleJobTimeoutSql() {
  return `${meetingJobStaleTimeoutSeconds()} seconds`
}

@Injectable()
export class MeetingsStore {
  constructor(
    private readonly db: PostgresService,
    private readonly queue: RedisQueueService
  ) {}

  async createMeeting(input: { title?: string; description?: string }) {
    const id = makeMeetingId()
    const title = input.title?.trim()
    if (!title) {
      throw new BadRequestException("Название встречи обязательно")
    }

    await this.db.transaction(async (client) => {
      await client.query(
        `
        insert into meetings (
          id, title, description, status, language, duration_seconds, speakers_count, processing_started_at, processing_finished_at, error_text, created_at, updated_at
        ) values (
          $1, $2, $3, 'draft', 'ru', null, 0, null, null, null, now(), now()
        )
        `,
        [id, title, input.description?.trim() ?? ""]
      )

      for (const stage of [
        "transcript_compiled",
        "meeting_summary",
        "meeting_protocol",
        "meeting_actions",
      ] as const) {
        await client.query(
          `
          insert into meeting_artifacts (
            id, meeting_id, stage, format, content_md, content_json, created_at, updated_at
          ) values
          ($1, $2, $3, 'md', $4, $5::jsonb, now(), now()),
          ($6, $7, $8, 'json', $9, $10::jsonb, now(), now())
          `,
          [
            `${id}-${stage}-md`,
            id,
            stage,
            "",
            JSON.stringify({ stage, markdown: "" }),
            `${id}-${stage}-json`,
            id,
            stage,
            "",
            JSON.stringify(
              stage === "meeting_actions"
                ? buildActionsJson("")
                : { stage, markdown: "" }
            ),
          ]
        )
      }
    })

    return this.getMeeting(id)
  }

  async listMeetings(page: number, limit: number) {
    const safeLimit = Math.max(1, Math.min(limit, 25))
    const safePage = Math.max(1, page)
    const offset = (safePage - 1) * safeLimit

    const meetingsResult = await this.db.query<Record<string, unknown>>(
      `
      select *
      from meetings
      order by updated_at desc
      limit $1 offset $2
      `,
      [safeLimit, offset]
    )
    const totalResult = await this.db.query<{ count: string }>(
      `select count(*)::text as count from meetings`
    )

    const items: MeetingListRecord[] = []
    for (const row of meetingsResult.rows) {
      const meetingId = String(row.id)
      await this.reconcileStaleMeetingJobs(meetingId)
      const freshMeeting = await this.getMeetingSummary(meetingId)
      const sourceFile = await this.getSourceFile(meetingId)
      const processingEstimate = await this.buildProcessingEstimate(sourceFile, meetingId)
      items.push({
        ...freshMeeting,
        sourceFile,
        processingMetrics: {
          ...freshMeeting.processingMetrics,
          estimatedSeconds: processingEstimate.estimatedSeconds,
          estimationSampleSize: processingEstimate.estimationSampleSize,
        },
      })
    }

    const total = Number(totalResult.rows[0]?.count ?? 0)
    return {
      items,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    }
  }

  async getMeeting(id: string) {
    await this.reconcileStaleMeetingJobs(id)
    await this.reconcilePendingMeetingUpload(id)
    await this.autoStartReadyMeeting(id)
    let meeting = await this.getMeetingSummary(id)
    const [sourceFile, speakers, jobs, artifacts] = await Promise.all([
      this.getSourceFile(id),
      this.listSpeakers(id),
      this.listJobs(id),
      this.listArtifacts(id),
    ])
    const processingEstimate = await this.buildProcessingEstimate(sourceFile, id)

    if (shouldMarkMeetingCompleted({ meeting, sourceFile, jobs, artifacts })) {
      await this.db.query(
        `
        update meetings
        set status = 'completed',
            processing_finished_at = coalesce(processing_finished_at, now()),
            updated_at = now()
        where id = $1
        `,
        [id]
      )
      meeting = {
        ...meeting,
        status: "completed",
        processingFinishedAt: meeting.processingFinishedAt ?? nowIso(),
        processingMetrics: {
          ...meeting.processingMetrics,
          actualSeconds:
            meeting.processingMetrics.actualSeconds ??
            processingDurationSeconds(
              meeting.processingStartedAt,
              meeting.processingFinishedAt ?? nowIso()
            ),
        },
        updatedAt: nowIso(),
      }
    }

    const speakersById = new Map(speakers.map((speaker) => [speaker.id, speaker]))
    const rawSegments = await this.db.query<Record<string, unknown>>(
      `
      select *
      from meeting_speaker_segments
      where meeting_id = $1
      order by start_ms asc, id asc
      `,
      [id]
    )

    return {
      ...meeting,
      processingMetrics: {
        ...meeting.processingMetrics,
        estimatedSeconds: processingEstimate.estimatedSeconds,
        estimationSampleSize: processingEstimate.estimationSampleSize,
      },
      sourceFile,
      speakers,
      segments: rawSegments.rows.map((row) => mapSegmentRow(row, speakersById)),
      jobs,
      artifacts,
    } satisfies MeetingDetailRecord
  }

  async updateMeeting(
    id: string,
    input: { title?: string; description?: string }
  ) {
    await this.getMeetingSummary(id)
    const nextTitle = input.title?.trim()
    const nextDescription = input.description?.trim()

    if (nextTitle != null && !nextTitle) {
      throw new BadRequestException("Название встречи не может быть пустым")
    }

    await this.db.query(
      `
      update meetings
      set
        title = coalesce($2, title),
        description = coalesce($3, description),
        updated_at = now()
      where id = $1
      `,
      [id, nextTitle ?? null, nextDescription ?? null]
    )

    return this.getMeeting(id)
  }

  async deleteMeeting(id: string) {
    await this.getMeetingSummary(id)
    await this.db.query(`delete from meetings where id = $1`, [id])
    return { id, deleted: true as const }
  }

  async initUpload(
    meetingId: string,
    input: { fileName: string; fileSize: number; mimeType: string }
  ) {
    if (!input.fileName.trim()) {
      throw new BadRequestException("Имя файла обязательно")
    }

    if (input.fileSize > MAX_MEETING_FILE_SIZE_BYTES) {
      throw new BadRequestException("Превышен лимит размера файла")
    }

    const sourceFileId = randomUUID()
    const storageKey = `meetings/${meetingId}/source/${sourceFileId}/${input.fileName}`

    let s3UploadId: string
    try {
      const result = await createMultipartUpload(storageKey, input.mimeType)
      s3UploadId = result.uploadId
    } catch (error) {
      throw new InternalServerErrorException(
        `Не удалось инициировать загрузку в S3: ${error instanceof Error ? error.message : String(error)}`
      )
    }

    return this.db.transaction(async (client) => {
      const meetingResult = await client.query<Record<string, unknown>>(
        `select * from meetings where id = $1 for update`,
        [meetingId]
      )
      if (meetingResult.rowCount === 0) {
        throw new NotFoundException("Встреча не найдена")
      }

      const existingFileResult = await client.query<{ count: string }>(
        `
        select count(*)::text as count
        from meeting_source_files
        where meeting_id = $1 and upload_status <> 'aborted'
        `,
        [meetingId]
      )
      if (Number(existingFileResult.rows[0]?.count ?? 0) > 0) {
        throw new BadRequestException("Для встречи уже загружен файл")
      }

      const uploadId = randomUUID()
      const bucket = process.env.S3_BUCKET ?? DEFAULT_S3_BUCKET

      await client.query(
        `
        insert into meeting_source_files (
          id, meeting_id, original_name, mime_type, size_bytes, storage_key, upload_status, processing_status, duration_seconds, audio_storage_key, audio_mime_type, created_at
        ) values (
          $1, $2, $3, $4, $5, $6, 'initiated', 'pending', null, null, null, now()
        )
      `,
        [
          sourceFileId,
          meetingId,
          input.fileName,
          input.mimeType,
          input.fileSize,
          storageKey,
        ]
      )

      await client.query(
        `
        insert into meeting_upload_sessions (
          id, meeting_id, source_file_id, s3_upload_id, status, created_at, completed_at, bucket, storage_key, original_name, mime_type, size_bytes
        ) values (
          $1, $2, $3, $4, 'initiated', now(), null, $5, $6, $7, $8, $9
        )
      `,
        [
          uploadId,
          meetingId,
          sourceFileId,
          s3UploadId,
          bucket,
          storageKey,
          input.fileName,
          input.mimeType,
          input.fileSize,
        ]
      )

      await client.query(
        `
        update meetings
        set status = 'uploaded', updated_at = now(), error_text = null
        where id = $1
        `,
        [meetingId]
      )

      return {
        uploadId,
        meetingId,
        sourceFileId,
        bucket,
        storageKey,
        partSize: 0,
        maxParts: Math.ceil(input.fileSize / (5 * 1024 * 1024)) || 1,
        uploadStatus: "initiated" as const,
      }
    })
  }

  async signUploadPart(uploadId: string, partNumber: number) {
    const session = await this.getUploadSession(uploadId)
    await this.db.query(
      `update meeting_upload_sessions set status = 'uploading' where id = $1`,
      [uploadId]
    )

    const endpoint = process.env.S3_ENDPOINT ?? DEFAULT_S3_ENDPOINT
    const region = process.env.S3_REGION ?? DEFAULT_S3_REGION
    const accessKeyId = process.env.S3_ACCESS_KEY_ID
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY
    const sessionToken = process.env.S3_SESSION_TOKEN

    if (!accessKeyId || !secretAccessKey) {
      throw new InternalServerErrorException("S3 credentials are not configured")
    }

    return {
      uploadId,
      partNumber,
      signedUrl: createS3UploadPartPresignedUrl({
        endpoint,
        region,
        accessKeyId,
        secretAccessKey,
        sessionToken,
        bucket: session.bucket,
        key: session.storageKey,
        uploadId: session.s3UploadId,
        partNumber,
      }),
      method: "PUT",
      headers: {},
    }
  }

  async completeUpload(uploadId: string, parts: CompletedPart[]) {
    const session = await this.getUploadSession(uploadId)

    try {
      await completeMultipartUpload(session.storageKey, session.s3UploadId, parts)
    } catch (error) {
      throw new InternalServerErrorException(
        `Не удалось завершить загрузку в S3: ${error instanceof Error ? error.message : String(error)}`
      )
    }

    await this.db.transaction(async (client) => {
      await client.query(
        `
        update meeting_upload_sessions
        set status = 'completed', completed_at = now()
        where id = $1
        `,
        [uploadId]
      )
      await client.query(
        `
        update meeting_source_files
        set upload_status = 'completed', processing_status = 'pending'
        where id = $1
        `,
        [session.sourceFileId]
      )
      await client.query(
        `
        update meetings
        set status = 'uploaded', updated_at = now(), error_text = null
        where id = $1
        `,
        [session.meetingId]
      )
    })

    return {
      uploadId,
      status: "completed" as const,
      storageKey: session.storageKey,
      completedAt: nowIso(),
    }
  }

  async abortUpload(uploadId: string) {
    const session = await this.getUploadSession(uploadId)

    await abortMultipartUpload(session.storageKey, session.s3UploadId)

    await this.db.transaction(async (client) => {
      await client.query(
        `update meeting_upload_sessions set status = 'aborted' where id = $1`,
        [uploadId]
      )
      await client.query(
        `
        update meeting_source_files
        set upload_status = 'aborted'
        where id = $1
        `,
        [session.sourceFileId]
      )
      await client.query(
        `
        update meetings
        set status = 'draft', updated_at = now()
        where id = $1
        `,
        [session.meetingId]
      )
    })

    return {
      uploadId,
      status: "aborted" as const,
    }
  }

  async startMeeting(id: string) {
    const meeting = await this.getMeetingSummary(id)
    let sourceFile = await this.getRequiredSourceFile(id)

    if (sourceFile.uploadStatus !== "completed") {
      await this.reconcilePendingMeetingUpload(id)
      sourceFile = await this.getRequiredSourceFile(id)
    }

    if (sourceFile.uploadStatus !== "completed") {
      throw new BadRequestException("Файл встречи ещё не загружен полностью")
    }

    const job = await this.queueMeetingJob(id, "audio_prepared", "start")
    return {
      meeting: await this.getMeeting(id),
      job,
    }
  }

  async generateMeetingStage(
    meetingId: string,
    input: { stage: Exclude<MeetingStageId, "audio_prepared">; overwriteExisting?: boolean }
  ) {
    const meeting = await this.getMeetingSummary(meetingId)
    if (meeting.status === "draft") {
      throw new BadRequestException("Сначала загрузите файл встречи")
    }

    if (
      input.stage !== "transcript_compiled" &&
      !(await this.hasDoneJob(meetingId, "transcript_compiled"))
    ) {
      throw new BadRequestException(
        "Сначала должен быть собран diarized transcript"
      )
    }

    const existingDone = await this.findLatestJob(meetingId, input.stage, "done")
    if (existingDone && !input.overwriteExisting) {
      throw new BadRequestException(
        "Этап уже был сгенерирован. Передайте overwriteExisting=true для перезаписи."
      )
    }

    const job = await this.queueMeetingJob(meetingId, input.stage, "manual", {
      overwriteExisting: Boolean(input.overwriteExisting),
    })

    return {
      meeting: await this.getMeeting(meetingId),
      job,
    }
  }

  async getMeetingStatus(id: string) {
    await this.reconcileStaleMeetingJobs(id)
    const meeting = await this.getMeetingSummary(id)
    return {
      id: meeting.id,
      status: meeting.status,
      updatedAt: meeting.updatedAt,
      processingStartedAt: meeting.processingStartedAt,
      processingFinishedAt: meeting.processingFinishedAt,
    }
  }

  async getTranscript(meetingId: string) {
    await this.reconcileStaleMeetingJobs(meetingId)
    const meeting = await this.getMeeting(meetingId)
    return {
      meetingId,
      speakers: meeting.speakers,
      segments: meeting.segments,
    }
  }

  async listSegments(meetingId: string) {
    const transcript = await this.getTranscript(meetingId)
    return transcript.segments
  }

  async updateSpeaker(
    meetingId: string,
    speakerId: string,
    input: { displayName: string }
  ) {
    const nextName = input.displayName.trim()
    if (!nextName) {
      throw new BadRequestException("Имя спикера не может быть пустым")
    }

    const result = await this.db.query<Record<string, unknown>>(
      `
      update meeting_speakers
      set display_name = $3, is_user_edited = true, updated_at = now()
      where meeting_id = $1 and id = $2
      returning *
      `,
      [meetingId, speakerId, nextName]
    )
    const row = result.rows[0]
    if (!row) {
      throw new NotFoundException("Спикер не найден")
    }
    return mapSpeakerRow(row)
  }

  async listArtifacts(meetingId: string) {
    await this.reconcileStaleMeetingJobs(meetingId)
    await this.getMeetingSummary(meetingId)
    const result = await this.db.query<Record<string, unknown>>(
      `
      select *
      from meeting_artifacts
      where meeting_id = $1
      order by stage, format
      `,
      [meetingId]
    )
    return result.rows.map(mapArtifactRow)
  }

  async getArtifact(meetingId: string, artifactId: string) {
    const result = await this.db.query<Record<string, unknown>>(
      `
      select *
      from meeting_artifacts
      where meeting_id = $1 and id = $2
      limit 1
      `,
      [meetingId, artifactId]
    )
    const row = result.rows[0]
    if (!row) {
      throw new NotFoundException("Артефакт не найден")
    }
    return mapArtifactRow(row)
  }

  async updateArtifact(
    meetingId: string,
    artifactId: string,
    input: { contentMd?: string; contentJson?: Record<string, unknown> }
  ) {
    const artifact = await this.getArtifact(meetingId, artifactId)
    const nextContentMd = input.contentMd ?? artifact.contentMd
    const nextContentJson =
      input.contentJson ??
      (artifact.stage === "meeting_actions"
        ? {
            ...buildActionsJson(nextContentMd),
            ...artifact.contentJson,
            markdown: nextContentMd,
          }
        : { stage: artifact.stage, markdown: nextContentMd })

    await this.db.query(
      `
      update meeting_artifacts
      set content_md = $3, content_json = $4::jsonb, updated_at = now()
      where meeting_id = $1 and id = $2
      `,
      [meetingId, artifactId, nextContentMd, JSON.stringify(nextContentJson)]
    )

    return this.getArtifact(meetingId, artifactId)
  }

  async listJobs(meetingId: string) {
    await this.reconcileStaleMeetingJobs(meetingId)
    await this.getMeetingSummary(meetingId)
    const result = await this.db.query<Record<string, unknown>>(
      `
      select *
      from meeting_jobs
      where meeting_id = $1
      order by created_at desc
      `,
      [meetingId]
    )
    return result.rows.map(mapJobRow)
  }

  async retryJob(meetingId: string, jobId: string) {
    await this.reconcileStaleMeetingJobs(meetingId)
    const result = await this.db.query<Record<string, unknown>>(
      `
      select *
      from meeting_jobs
      where meeting_id = $1 and id = $2
      limit 1
      `,
      [meetingId, jobId]
    )
    const row = result.rows[0]
    if (!row) {
      throw new NotFoundException("Job не найден")
    }

    const stage = String(row.stage) as MeetingStageId
    await this.db.transaction(async (client) => {
      await client.query(
        `
        update meeting_jobs
        set
          status = 'queued',
          started_at = null,
          finished_at = null,
          error_text = null,
          payload_json = $2::jsonb
        where id = $1
        `,
        [
          jobId,
          JSON.stringify({
            stage,
            trigger: "retry",
          }),
        ]
      )
      await client.query(
        `
        update meetings
        set
          status = 'processing',
          processing_started_at = coalesce(processing_started_at, now()),
          processing_finished_at = null,
          error_text = null,
          updated_at = now()
        where id = $1
        `,
        [meetingId]
      )
    })

    await this.queue.enqueueMeetingJob({
      jobId,
      meetingId,
      stage,
      trigger: "retry",
    })

    return this.getJob(meetingId, jobId)
  }

  async downloadMeeting(meetingId: string) {
    const artifacts = await this.listArtifacts(meetingId)
    const extensionForFormat = (format: ArtifactFormat) =>
      format === "md" ? "md" : "json"

    return artifacts.map((artifact) => ({
      id: artifact.id,
      type: artifact.stage,
      format: artifact.format,
      fileName: `${artifact.stage}.${extensionForFormat(artifact.format)}`,
      downloadUrl: `/api/meetings/${meetingId}/artifacts/${artifact.id}`,
    }))
  }

  private async queueMeetingJob(
    meetingId: string,
    stage: MeetingStageId,
    trigger: "start" | "manual" | "retry",
    extraPayload: Record<string, unknown> = {}
  ) {
    await this.getMeetingSummary(meetingId)
    const created = await this.db.transaction(async (client) => {
      const createdResult = await client.query<Record<string, unknown>>(
        `
        insert into meeting_jobs (
          id, meeting_id, stage, status, payload_json, result_json, error_text, started_at, processing_heartbeat_at, finished_at, created_at
        ) values (
          $1, $2, $3, 'queued', $4::jsonb, null, null, null, null, null, now()
        )
        returning *
        `,
        [
          randomUUID(),
          meetingId,
          stage,
          JSON.stringify({
            stage,
            trigger,
            ...extraPayload,
          }),
        ]
      )

      await client.query(
        `
        update meetings
        set
          status = 'processing',
          processing_started_at = coalesce(processing_started_at, now()),
          processing_finished_at = null,
          error_text = null,
          updated_at = now()
        where id = $1
        `,
        [meetingId]
      )

      return mapJobRow(createdResult.rows[0] ?? {})
    })

    await this.queue.enqueueMeetingJob({
      jobId: created.id,
      meetingId,
      stage,
      trigger,
    })

    return created
  }

  private async hasDoneJob(meetingId: string, stage: MeetingStageId) {
    return Boolean(await this.findLatestJob(meetingId, stage, "done"))
  }

  private async findLatestJob(
    meetingId: string,
    stage: MeetingStageId,
    status: JobStatus
  ) {
    const result = await this.db.query<Record<string, unknown>>(
      `
      select *
      from meeting_jobs
      where meeting_id = $1 and stage = $2 and status = $3
      order by created_at desc
      limit 1
      `,
      [meetingId, stage, status]
    )
    return result.rows[0] ? mapJobRow(result.rows[0]) : null
  }

  private async getJob(meetingId: string, jobId: string) {
    const result = await this.db.query<Record<string, unknown>>(
      `
      select *
      from meeting_jobs
      where meeting_id = $1 and id = $2
      limit 1
      `,
      [meetingId, jobId]
    )
    const row = result.rows[0]
    if (!row) {
      throw new NotFoundException("Job не найден")
    }
    return mapJobRow(row)
  }

  private async getMeetingSummary(id: string) {
    const result = await this.db.query<Record<string, unknown>>(
      `select * from meetings where id = $1 limit 1`,
      [id]
    )
    const row = result.rows[0]
    if (!row) {
      throw new NotFoundException("Встреча не найдена")
    }
    return mapMeetingRow(row)
  }

  private async reconcileStaleMeetingJobs(meetingId: string) {
    const staleJobsResult = await this.db.query<Record<string, unknown>>(
      `
      select id, stage, status
      from meeting_jobs
      where meeting_id = $1
        and status in ('queued', 'processing')
        and coalesce(processing_heartbeat_at, started_at, created_at) < now() - $2::interval
      order by created_at asc
      `,
      [meetingId, staleJobTimeoutSql()]
    )

    if (staleJobsResult.rowCount === 0) {
      return
    }

    const staleJobIds = staleJobsResult.rows.map((row) => String(row.id))
    const staleJobStages = staleJobsResult.rows
      .map((row) => String(row.stage))
      .join(", ")
    const staleErrorText = `Задача обработки зависла и была автоматически остановлена. Проверьте worker и запустите этап заново.`

    await this.db.transaction(async (client) => {
      await client.query(
        `
        update meeting_jobs
        set
          status = 'failed',
          error_text = $2,
          finished_at = now()
        where id = any($1::text[])
        `,
        [staleJobIds, staleErrorText]
      )
      await client.query(
        `
        update meeting_source_files
        set processing_status = 'failed'
        where meeting_id = $1 and processing_status = 'processing'
        `,
        [meetingId]
      )
      await client.query(
        `
        update meetings
        set
          status = 'failed',
          error_text = $2,
          processing_finished_at = now(),
          updated_at = now()
        where id = $1 and status = 'processing'
        `,
        [meetingId, `${staleErrorText} Затронутые этапы: ${staleJobStages}.`]
      )
    })
  }

  private async reconcilePendingMeetingUpload(meetingId: string) {
    const sourceFile = await this.getSourceFile(meetingId)
    if (!sourceFile || sourceFile.uploadStatus === "completed" || sourceFile.uploadStatus === "aborted") {
      return
    }

    const sessionResult = await this.db.query<Record<string, unknown>>(
      `
      select *
      from meeting_upload_sessions
      where meeting_id = $1 and status in ('initiated', 'uploading')
      order by created_at desc
      limit 1
      `,
      [meetingId]
    )
    const session = sessionResult.rows[0]
    if (!session) {
      return
    }

    const bucket = String(session.bucket ?? "")
    const storageKey = String(session.storage_key ?? "")
    if (!bucket || !storageKey) {
      return
    }

    const objectExists = await this.checkS3ObjectExists(bucket, storageKey)
    if (!objectExists) {
      return
    }

    await this.db.transaction(async (client) => {
      await client.query(
        `
        update meeting_upload_sessions
        set status = 'completed',
            completed_at = coalesce(completed_at, now())
        where id = $1
        `,
        [String(session.id)]
      )
      await client.query(
        `
        update meeting_source_files
        set upload_status = 'completed',
            processing_status = case
              when processing_status = 'processing' then processing_status
              else 'pending'
            end
        where id = $1
        `,
        [String(session.source_file_id)]
      )
      await client.query(
        `
        update meetings
        set status = case
              when status = 'draft' then 'uploaded'
              when status = 'uploaded' then 'uploaded'
              else status
            end,
            error_text = case
              when status in ('draft', 'uploaded') then null
              else error_text
            end,
            updated_at = now()
        where id = $1
        `,
        [meetingId]
      )
    })
  }

  private async autoStartReadyMeeting(meetingId: string) {
    const created = await this.db.transaction(async (client) => {
      const meetingResult = await client.query<Record<string, unknown>>(
        `select * from meetings where id = $1 for update`,
        [meetingId]
      )
      const meetingRow = meetingResult.rows[0]
      if (!meetingRow || String(meetingRow.status) !== "uploaded") {
        return null
      }

      const sourceFileResult = await client.query<Record<string, unknown>>(
        `
        select *
        from meeting_source_files
        where meeting_id = $1
        limit 1
        `,
        [meetingId]
      )
      const sourceFileRow = sourceFileResult.rows[0]
      if (!sourceFileRow || String(sourceFileRow.upload_status) !== "completed") {
        return null
      }

      const jobsResult = await client.query<{ count: string }>(
        `
        select count(*)::text as count
        from meeting_jobs
        where meeting_id = $1
        `,
        [meetingId]
      )
      if (Number(jobsResult.rows[0]?.count ?? 0) > 0) {
        return null
      }

      const createdResult = await client.query<Record<string, unknown>>(
        `
        insert into meeting_jobs (
          id, meeting_id, stage, status, payload_json, result_json, error_text, started_at, processing_heartbeat_at, finished_at, created_at
        ) values (
          $1, $2, 'audio_prepared', 'queued', $3::jsonb, null, null, null, null, null, now()
        )
        returning *
        `,
        [
          randomUUID(),
          meetingId,
          JSON.stringify({
            stage: "audio_prepared",
            trigger: "start",
          }),
        ]
      )

      await client.query(
        `
        update meetings
        set
          status = 'processing',
          processing_started_at = coalesce(processing_started_at, now()),
          processing_finished_at = null,
          error_text = null,
          updated_at = now()
        where id = $1
        `,
        [meetingId]
      )

      return mapJobRow(createdResult.rows[0] ?? {})
    })

    if (!created) {
      return
    }

    await this.queue.enqueueMeetingJob({
      jobId: created.id,
      meetingId,
      stage: created.stage,
      trigger: "start",
    })
  }

  private async buildProcessingEstimate(
    sourceFile: MeetingSourceFileRecord | null,
    excludeMeetingId?: string
  ) {
    if (!sourceFile || sourceFile.sizeBytes <= 0) {
      return {
        estimatedSeconds: null,
        estimationSampleSize: 0,
      }
    }

    const result = await this.db.query<Record<string, unknown>>(
      `
      select
        m.id,
        m.processing_started_at,
        m.processing_finished_at,
        msf.size_bytes,
        msf.mime_type,
        msf.duration_seconds
      from meetings m
      join meeting_source_files msf on msf.meeting_id = m.id
      where m.status = 'completed'
        and m.processing_started_at is not null
        and m.processing_finished_at is not null
        and msf.upload_status = 'completed'
        and msf.size_bytes > 0
        and coalesce(msf.duration_seconds, 0) > 0
        and ($1::text is null or m.id <> $1)
      order by m.processing_finished_at desc
      limit 40
      `,
      [excludeMeetingId ?? null]
    )

    const samples = result.rows
      .map((row) => {
        const actualSeconds = processingDurationSeconds(
          (row.processing_started_at as string | null) ?? null,
          (row.processing_finished_at as string | null) ?? null
        )
        const sizeBytes = Number(row.size_bytes ?? 0)
        return {
          sizeBytes,
          actualSeconds,
          mimeFamily: String(row.mime_type ?? "").split("/")[0] ?? "",
          durationSeconds: Number(row.duration_seconds ?? 0),
        }
      })
      .filter(
        (item) =>
          item.actualSeconds != null &&
          Number.isFinite(item.actualSeconds) &&
          item.actualSeconds > 0 &&
          Number.isFinite(item.durationSeconds) &&
          item.durationSeconds > 0 &&
          Number.isFinite(item.sizeBytes) &&
          item.sizeBytes > 0
      )

    if (samples.length === 0) {
      return {
        estimatedSeconds: null,
        estimationSampleSize: 0,
      }
    }

    const currentMimeFamily = sourceFile.mimeType.split("/")[0] ?? ""
    const comparablePool =
      currentMimeFamily.length > 0
        ? samples.filter((item) => item.mimeFamily === currentMimeFamily)
        : []
    const fallbackPool = comparablePool.length >= 3 ? comparablePool : samples
    const nearestSamples = [...fallbackPool]
      .sort(
        (left, right) =>
          Math.abs(left.sizeBytes - sourceFile.sizeBytes) -
          Math.abs(right.sizeBytes - sourceFile.sizeBytes)
      )
      .slice(0, Math.min(fallbackPool.length, 7))

    const ratio = median(
      nearestSamples.map((item) => Number(item.actualSeconds) / item.sizeBytes)
    )
    if (ratio == null || !Number.isFinite(ratio) || ratio <= 0) {
      return {
        estimatedSeconds: null,
        estimationSampleSize: nearestSamples.length,
      }
    }

    return {
      estimatedSeconds: Math.max(30, Math.round(ratio * sourceFile.sizeBytes)),
      estimationSampleSize: nearestSamples.length,
    }
  }

  private async checkS3ObjectExists(bucket: string, key: string) {
    const endpoint = process.env.S3_ENDPOINT ?? DEFAULT_S3_ENDPOINT
    const region = process.env.S3_REGION ?? DEFAULT_S3_REGION
    const accessKeyId = process.env.S3_ACCESS_KEY_ID
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY
    const sessionToken = process.env.S3_SESSION_TOKEN

    if (!accessKeyId || !secretAccessKey) {
      throw new InternalServerErrorException("S3 credentials are not configured")
    }

    const signedUrl = createS3HeadObjectPresignedUrl({
      endpoint,
      region,
      accessKeyId,
      secretAccessKey,
      sessionToken,
      bucket,
      key,
    })

    try {
      const response = await fetch(signedUrl, {
        method: "HEAD",
        cache: "no-store",
      })
      return response.ok
    } catch {
      return false
    }
  }

  private async getSourceFile(meetingId: string) {
    const result = await this.db.query<Record<string, unknown>>(
      `
      select *
      from meeting_source_files
      where meeting_id = $1
      limit 1
      `,
      [meetingId]
    )
    const row = result.rows[0]
    return row ? mapSourceFileRow(row) : null
  }

  private async getRequiredSourceFile(meetingId: string) {
    const sourceFile = await this.getSourceFile(meetingId)
    if (!sourceFile) {
      throw new BadRequestException("Для встречи не загружен файл")
    }
    return sourceFile
  }

  private async listSpeakers(meetingId: string) {
    const result = await this.db.query<Record<string, unknown>>(
      `
      select *
      from meeting_speakers
      where meeting_id = $1
      order by sort_order asc, created_at asc
      `,
      [meetingId]
    )
    return result.rows.map(mapSpeakerRow)
  }

  private async getUploadSession(uploadId: string) {
    const result = await this.db.query<Record<string, unknown>>(
      `
      select *
      from meeting_upload_sessions
      where id = $1
      limit 1
      `,
      [uploadId]
    )
    const row = result.rows[0]
    if (!row) {
      throw new NotFoundException("Upload session не найдена")
    }
    return {
      id: String(row.id),
      meetingId: String(row.meeting_id),
      sourceFileId: String(row.source_file_id),
      s3UploadId: String(row.s3_upload_id),
      bucket: String(row.bucket),
      storageKey: String(row.storage_key),
      originalName: String(row.original_name),
    }
  }
}
