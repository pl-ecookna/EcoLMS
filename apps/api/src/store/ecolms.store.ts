import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common"
import { randomUUID } from "node:crypto"

import { PostgresService } from "../db/postgres.service"
import { RedisQueueService } from "../redis/redis.service"
import { createS3UploadPartPresignedUrl } from "../s3/s3-presign"
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  type CompletedPart,
} from "../s3/s3-multipart"

const DEFAULT_S3_ENDPOINT = "https://s3.ru1.storage.beget.cloud"
const DEFAULT_S3_BUCKET = "1bf1b61c108f-ecolms"
const DEFAULT_S3_REGION = "ru1"

export const stageOrder = [
  "source_compiled",
  "course_outline",
  "course_content",
  "course_test",
] as const

export type StageId = (typeof stageOrder)[number]
export type ProjectStatus =
  | "draft"
  | "uploaded"
  | "processing"
  | "completed"
  | "failed"
export type JobStatus = "queued" | "processing" | "done" | "failed"
export type UploadStatus = "initiated" | "uploading" | "completed" | "aborted"
export type ArtifactFormat = "md" | "json"
export type PromptModule = "lms" | "meetings"

export interface PromptRecord {
  module: PromptModule
  promptKey: string
  title: string
  systemPrompt: string
  userPromptTemplate: string
  createdAt: string
  updatedAt: string
}

export interface SourceFileRecord {
  id: string
  projectId: string
  originalName: string
  mimeType: string
  sizeBytes: number
  storageKey: string
  uploadStatus: UploadStatus
  processingStatus: JobStatus | "pending"
  kind: string
  position: number
  createdAt: string
}

export interface UploadSessionRecord {
  id: string
  projectId: string
  sourceFileId: string
  s3UploadId: string
  status: UploadStatus
  createdAt: string
  completedAt: string | null
  bucket: string
  storageKey: string
  originalName: string
  mimeType: string
  sizeBytes: number
  kind: string
}

export interface ProcessingJobRecord {
  id: string
  projectId: string
  stage: StageId
  status: JobStatus
  payloadJson: Record<string, unknown>
  resultJson: Record<string, unknown> | null
  errorText: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}

export interface ArtifactRecord {
  id: string
  projectId: string
  stage: StageId
  format: ArtifactFormat
  storageKey: string
  contentMd: string
  contentJson: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface StageReviewRecord {
  id: string
  projectId: string
  stage: StageId
  sourceArtifactId: string
  editedArtifactId: string
  approvedAt: string
}

export interface ProjectStageRecord {
  id: StageId
  status: JobStatus
  note: string
  updatedAt: string
}

export interface ProjectRecord {
  id: string
  name: string
  githubRef: string
  sourceSummary: string
  status: ProjectStatus
  currentStage: StageId
  progress: number
  files: number
  updatedAt: string
  overview: string
  stageDrafts: Record<StageId, string>
  stages: ProjectStageRecord[]
  logs: string[]
  sourceFiles: SourceFileRecord[]
}

export interface ProjectDetailRecord extends ProjectRecord {
  artifacts: ArtifactRecord[]
  jobs: ProcessingJobRecord[]
  reviews: StageReviewRecord[]
}

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024
const MAX_FILES_PER_PROJECT = 5

function promptKeysForStage(stage: StageId) {
  switch (stage) {
    case "source_compiled":
      return ["analize_video", "analize_doc"]
    case "course_outline":
      return ["generate_plan"]
    case "course_content":
      return ["generate_materials"]
    case "course_test":
      return ["generate_test"]
  }
}

function nowIso() {
  return new Date().toISOString()
}

function mapPromptRow(row: Record<string, unknown>): PromptRecord {
  return {
    module: String(row.module) as PromptModule,
    promptKey: String(row.prompt_key),
    title: String(row.title),
    systemPrompt: String(row.system_prompt),
    userPromptTemplate: String(row.user_prompt_template ?? ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function makeNameFromGithubRef(githubRef: string) {
  const normalized = githubRef
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")
  const last = normalized.split("/").filter(Boolean).at(-1) ?? "project"
  return last.replace(/[-_]+/g, " ").trim()
}

function buildDrafts(_name: string, _topic: string): Record<StageId, string> {
  return {
    source_compiled: "",
    course_outline: "",
    course_content: "",
    course_test: "",
  }
}

function progressFor(stage: StageId, status: ProjectStatus) {
  if (status === "completed") {
    return 100
  }

  switch (stage) {
    case "source_compiled":
      return status === "draft" ? 0 : 18
    case "course_outline":
      return 44
    case "course_content":
      return 68
    case "course_test":
      return 88
  }
}

function nextStageFor(stage: StageId): StageId | null {
  const next = stageOrder[stageOrder.indexOf(stage) + 1]
  return next ?? null
}

function stageGenerationDone(stage: StageId, jobs: ProcessingJobRecord[]) {
  return jobs.some((job) => job.stage === stage && job.status === "done")
}

function stageMarkdown(project: ProjectDetailRecord, stage: StageId) {
  const artifact = project.artifacts.find(
    (item) => item.stage === stage && item.format === "md"
  )
  const value = artifact?.contentMd ?? project.stageDrafts[stage] ?? ""
  return value.trim()
}

function buildStages(
  currentStage: StageId,
  status: ProjectStatus,
  updatedAt: string,
  jobs: ProcessingJobRecord[]
): ProjectStageRecord[] {
  return stageOrder.map((stageId, index) => {
    const stageJobs = jobs.filter((job) => job.stage === stageId)
    const latest = stageJobs.sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    )[0]
    const stageStatus: JobStatus =
      latest?.status ??
      (status === "completed" || index < stageOrder.indexOf(currentStage)
        ? "done"
        : status === "processing" && stageId === currentStage
          ? "processing"
          : "queued")

    return {
      id: stageId,
      status: stageStatus,
      note:
        stageId === "source_compiled"
          ? "Нормализация исходников и удаление шума."
          : stageId === "course_outline"
            ? "Строим структуру курса до 10 разделов."
            : stageId === "course_content"
              ? "Разворачиваем материалы в обучающий текст."
              : "Формируем базовый тест из 10 вопросов.",
      updatedAt: latest?.createdAt ?? updatedAt,
    }
  })
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

function isStageId(value: string): value is StageId {
  return stageOrder.includes(value as StageId)
}

function mapSourceFileRow(row: Record<string, unknown>): SourceFileRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    originalName: String(row.original_name),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    storageKey: String(row.storage_key),
    uploadStatus: String(row.upload_status) as UploadStatus,
    processingStatus: String(row.processing_status) as JobStatus | "pending",
    kind: String(row.kind),
    position: Number(row.position),
    createdAt: String(row.created_at),
  }
}

function mapArtifactRow(row: Record<string, unknown>): ArtifactRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    stage: String(row.stage) as StageId,
    format: String(row.format) as ArtifactFormat,
    storageKey: String(row.storage_key),
    contentMd: String(row.content_md),
    contentJson: parseJson<Record<string, unknown>>(row.content_json, {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function mapJobRow(row: Record<string, unknown>): ProcessingJobRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    stage: String(row.stage) as StageId,
    status: String(row.status) as JobStatus,
    payloadJson: parseJson<Record<string, unknown>>(row.payload_json, {}),
    resultJson: parseJson<Record<string, unknown> | null>(row.result_json, null),
    errorText: (row.error_text as string | null) ?? null,
    startedAt: (row.started_at as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
    createdAt: String(row.created_at),
  }
}

function mapReviewRow(row: Record<string, unknown>): StageReviewRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    stage: String(row.stage) as StageId,
    sourceArtifactId: String(row.source_artifact_id),
    editedArtifactId: String(row.edited_artifact_id),
    approvedAt: String(row.approved_at),
  }
}

function mapProjectRow(
  row: Record<string, unknown>,
  sourceFiles: SourceFileRecord[],
  jobs: ProcessingJobRecord[]
): ProjectRecord {
  const currentStage = String(row.current_stage)
  const statusRaw = String(row.status)
  const status = statusRaw === "awaiting_review" ? "uploaded" : statusRaw
  const stageDrafts = parseJson<Record<StageId, string>>(row.stage_drafts, {
    source_compiled: "",
    course_outline: "",
    course_content: "",
    course_test: "",
  })

  return {
    id: String(row.id),
    name: String(row.name),
    githubRef: String(row.github_ref),
    sourceSummary: String(row.source_summary),
    status: status as ProjectStatus,
    currentStage: (isStageId(currentStage) ? currentStage : "source_compiled") as StageId,
    progress: Number(row.progress ?? 0),
    files: Number(row.files ?? 0),
    updatedAt: String(row.updated_at),
    overview: String(row.overview ?? ""),
    stageDrafts,
    stages: buildStages(
      isStageId(currentStage) ? currentStage : "source_compiled",
      status as ProjectStatus,
      String(row.updated_at),
      jobs
    ),
    logs: parseJson<string[]>(row.logs, []),
    sourceFiles,
  }
}

function makeProjectId() {
  return `eco-${randomUUID().slice(0, 8)}`
}

@Injectable()
export class EcolmsStore {
  constructor(
    private readonly db: PostgresService,
    private readonly queue: RedisQueueService
  ) {}

  async health() {
    const stats = await this.db.stats()
    return {
      success: true,
      data: {
        status: "ok",
        mode: "postgres",
        projects: stats.projects,
        uploads: stats.uploads,
      },
      error: null,
    }
  }

  async listPrompts(module?: PromptModule) {
    const result = module
      ? await this.db.query<Record<string, unknown>>(
          `
          select *
          from llm_prompts
          where module = $1
          order by module asc, prompt_key asc
          `,
          [module]
        )
      : await this.db.query<Record<string, unknown>>(
          `
          select *
          from llm_prompts
          order by module asc, prompt_key asc
          `
        )

    return result.rows.map(mapPromptRow)
  }

  async getPrompt(module: PromptModule, promptKey: string) {
    const result = await this.db.query<Record<string, unknown>>(
      `
      select *
      from llm_prompts
      where module = $1 and prompt_key = $2
      limit 1
      `,
      [module, promptKey]
    )
    if (result.rowCount === 0) {
      throw new NotFoundException("Промпт не найден")
    }
    return mapPromptRow(result.rows[0]!)
  }

  async updatePrompt(
    module: PromptModule,
    promptKey: string,
    input: {
      title?: string
      systemPrompt?: string
      userPromptTemplate?: string
    }
  ) {
    const nextTitle = input.title?.trim()
    const nextSystemPrompt = input.systemPrompt?.trim()
    const nextUserPromptTemplate = input.userPromptTemplate?.trim()

    if (nextTitle !== undefined && !nextTitle) {
      throw new BadRequestException("Название промпта не может быть пустым")
    }
    if (nextSystemPrompt !== undefined && !nextSystemPrompt) {
      throw new BadRequestException("System prompt не может быть пустым")
    }
    if (nextUserPromptTemplate !== undefined && !nextUserPromptTemplate) {
      throw new BadRequestException("User prompt template не может быть пустым")
    }

    const result = await this.db.query<Record<string, unknown>>(
      `
      update llm_prompts
      set
        title = coalesce($3, title),
        system_prompt = coalesce($4, system_prompt),
        user_prompt_template = coalesce($5, user_prompt_template),
        updated_at = now()
      where module = $1 and prompt_key = $2
      returning *
      `,
      [
        module,
        promptKey,
        nextTitle ?? null,
        nextSystemPrompt ?? null,
        nextUserPromptTemplate ?? null,
      ]
    )

    if (result.rowCount === 0) {
      throw new NotFoundException("Промпт не найден")
    }

    return mapPromptRow(result.rows[0]!)
  }

  async listProjects(page: number, limit: number) {
    const safeLimit = Math.max(1, Math.min(limit, 25))
    const safePage = Math.max(1, page)
    const offset = (safePage - 1) * safeLimit

    const projectsResult = await this.db.query<Record<string, unknown>>(
      `
      select *
      from projects
      order by updated_at desc
      limit $1 offset $2
    `,
      [safeLimit, offset]
    )

    const total = await this.db.countProjects()
    const items: ProjectRecord[] = []
    for (const row of projectsResult.rows) {
      const projectId = String(row.id)
      const [sourceFiles, jobs] = await Promise.all([
        this.listSourceFiles(projectId),
        this.listJobs(projectId),
      ])
      items.push(mapProjectRow(row, sourceFiles, jobs))
    }

    return {
      items,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    }
  }

  async getProject(id: string) {
    return this.loadProjectDetail(id)
  }

  async createProject(input: { name?: string; githubRef?: string; note?: string }) {
    const id = makeProjectId()
    const trimmedName = input.name?.trim()
    const githubRef = input.githubRef?.trim() || `manual://${id}`
    const name =
      trimmedName || `${makeNameFromGithubRef(githubRef)} ${id.slice(-4)}`
    const sourceSummary = input.note ?? "Новый курс, ожидающий загрузки материалов"
    const stageDrafts = buildDrafts(name, input.note ?? "нового обучающего курса")
    const now = nowIso()

    await this.db.transaction(async (client) => {
      await client.query(
        `
        insert into projects (
          id, name, github_ref, source_summary, status, current_stage, progress, files, updated_at, overview, stage_drafts, logs
        ) values (
          $1, $2, $3, $4, 'draft', 'source_compiled', 0, 0, $5::timestamptz,
          $6, $7::jsonb, $8::jsonb
        )
      `,
        [
          id,
          name,
          githubRef,
          sourceSummary,
          now,
          "",
          JSON.stringify(stageDrafts),
          JSON.stringify([
            trimmedName
              ? "Курс создан вручную."
              : "Курс создан из GitHub-источника.",
          ]),
        ]
      )

      for (const stage of stageOrder) {
        await client.query(
          `
          insert into artifacts (
            id, project_id, stage, format, storage_key, content_md, content_json, created_at, updated_at
          ) values
          ($1, $2, $3, 'md', $4, $5, $6::jsonb, now(), now()),
          ($7, $8, $9, 'json', $10, $11, $12::jsonb, now(), now())
        `,
          [
            `${id}-${stage}-md`,
            id,
            stage,
            `artifacts/${id}/${stage}.md`,
            stageDrafts[stage],
            JSON.stringify({ stage, markdown: stageDrafts[stage] }),
            `${id}-${stage}-json`,
            id,
            stage,
            `artifacts/${id}/${stage}.json`,
            stageDrafts[stage],
            JSON.stringify({ stage, markdown: stageDrafts[stage] }),
          ]
        )
      }
    })

    return this.getProject(id)
  }

  async startProject(id: string) {
    const project = await this.loadProjectDetail(id)
    if (project.sourceFiles.length === 0) {
      throw new BadRequestException("Проект нельзя запустить без загруженных файлов")
    }

    const job = await this.db.transaction(async (client) => {
      const created = await client.query<Record<string, unknown>>(
        `
        insert into processing_jobs (
          id, project_id, stage, status, payload_json, result_json, error_text, started_at, finished_at, created_at
        ) values (
          $1, $2, $3, 'queued', $4::jsonb, null, null, null, null, now()
        )
        returning *
      `,
        [
          randomUUID(),
          id,
          project.currentStage,
          JSON.stringify({
            stage: project.currentStage,
            promptKeys: promptKeysForStage(project.currentStage),
          }),
        ]
      )

      await client.query(
        `
        update projects
        set status = 'processing', updated_at = now(), logs = $2::jsonb
        where id = $1
      `,
        [id, JSON.stringify([`Запуск обработки для этапа ${project.currentStage}.`, ...project.logs].slice(0, 10))]
      )

      return mapJobRow(created.rows[0] ?? {})
    })

    await this.queue.enqueueProcessingJob({
      jobId: job.id,
      projectId: id,
      stage: job.stage,
      trigger: "start",
    })

    return { project: await this.getProject(id), job }
  }

  async updateProject(
    id: string,
    input: {
      note?: string
      name?: string
    }
  ) {
    const project = await this.loadProjectSummary(id)
    const nextName = input.name?.trim() || project.name
    const nextNote = input.note?.trim() ?? project.sourceSummary

    await this.db.query(
      `
      update projects
      set
        name = $2,
        source_summary = $3,
        updated_at = now(),
        logs = $4::jsonb
      where id = $1
      `,
      [
        id,
        nextName,
        nextNote,
        JSON.stringify(["Обновлены параметры курса.", ...(project.logs ?? [])].slice(0, 10)),
      ]
    )

    return this.getProject(id)
  }

  async deleteSourceFile(projectId: string, sourceFileId: string) {
    const project = await this.loadProjectSummary(projectId)
    const fileExists = project.sourceFiles.some((file) => file.id === sourceFileId)
    if (!fileExists) {
      throw new NotFoundException("Файл не найден")
    }

    await this.db.transaction(async (client) => {
      await client.query(
        `delete from source_files where id = $1 and project_id = $2`,
        [sourceFileId, projectId]
      )

      const countResult = await client.query<{ count: string }>(
        `select count(*)::text as count from source_files where project_id = $1`,
        [projectId]
      )
      const filesCount = Number(countResult.rows[0]?.count ?? 0)

      await client.query(
        `
        update projects
        set
          files = $2,
          status = case when $2 = 0 then 'draft' else 'uploaded' end,
          updated_at = now(),
          logs = $3::jsonb
        where id = $1
        `,
        [
          projectId,
          filesCount,
          JSON.stringify(["Удалён исходный файл курса.", ...(project.logs ?? [])].slice(0, 10)),
        ]
      )
    })

    return this.getProject(projectId)
  }

  async deleteProject(id: string) {
    await this.loadProjectSummary(id)
    await this.db.query(`delete from projects where id = $1`, [id])
    return { id, deleted: true as const }
  }

  async generateStage(
    projectId: string,
    input: {
      stage:
        | "source_compiled"
        | "course_outline"
        | "course_content"
        | "course_test"
      autoGenerateAll?: boolean
      overwriteExisting?: boolean
    }
  ) {
    const targetStage = input.stage
    const autoGenerateAll = Boolean(input.autoGenerateAll)
    const overwriteExisting = Boolean(input.overwriteExisting)
    const project = await this.loadProjectDetail(projectId)

    if (project.sourceFiles.length === 0) {
      throw new BadRequestException("Сначала загрузите исходные файлы")
    }

    const jobs = await this.listJobs(projectId)
    const isDone = (stage: StageId) => stageGenerationDone(stage, jobs)
    const sourceReady = isDone("source_compiled")
    const sourceTextReady = Boolean(stageMarkdown(project, "source_compiled"))
    const outlineReady = isDone("course_outline")
    const contentReady = isDone("course_content")

    if (targetStage === "course_outline" && !sourceReady) {
      throw new BadRequestException(
        "Сначала запустите и завершите этап «Источник»."
      )
    }
    if (targetStage === "course_outline" && !sourceTextReady) {
      throw new BadRequestException(
        "Этап «Источник» должен содержать текст перед генерацией плана."
      )
    }
    if (targetStage === "course_content" && !outlineReady) {
      throw new BadRequestException("Сначала создайте план курса")
    }
    if (targetStage === "course_content" && (!sourceReady || !sourceTextReady)) {
      throw new BadRequestException(
        "Сначала завершите и заполните этап «Источник»."
      )
    }
    if (targetStage === "course_test" && !contentReady) {
      throw new BadRequestException("Сначала создайте обучающие материалы")
    }
    if (targetStage === "course_test" && (!sourceReady || !sourceTextReady)) {
      throw new BadRequestException(
        "Сначала завершите и заполните этап «Источник»."
      )
    }

    if (isDone(targetStage) && !overwriteExisting) {
      throw new BadRequestException(
        "Этап уже сгенерирован. Передайте overwriteExisting=true для перезаписи."
      )
    }

    const queuedStage: StageId = targetStage
    const nextStageAfterCurrent = autoGenerateAll
      ? nextStageFor(queuedStage)
      : null

    const job = await this.db.transaction(async (client) => {
      const created = await client.query<Record<string, unknown>>(
        `
        insert into processing_jobs (
          id, project_id, stage, status, payload_json, result_json, error_text, started_at, finished_at, created_at
        ) values (
          $1, $2, $3, 'queued', $4::jsonb, null, null, null, null, now()
        )
        returning *
      `,
        [
          randomUUID(),
          projectId,
          queuedStage,
          JSON.stringify({
            stage: queuedStage,
            trigger: autoGenerateAll ? "auto" : "manual",
            promptKeys: promptKeysForStage(queuedStage),
            autoGenerateAll,
            nextStage: nextStageAfterCurrent,
          }),
        ]
      )

      await client.query(
        `
        update projects
        set
          current_stage = $2,
          status = 'processing',
          progress = $3,
          updated_at = now(),
          logs = $4::jsonb
        where id = $1
      `,
        [
          projectId,
          queuedStage,
          progressFor(queuedStage, "processing"),
          JSON.stringify(
            [
              autoGenerateAll
                ? `Запущена автогенерация с этапа ${queuedStage}.`
                : `Запущена генерация этапа ${queuedStage}.`,
              ...(project.logs ?? []),
            ].slice(0, 10)
          ),
        ]
      )

      return mapJobRow(created.rows[0] ?? {})
    })

    await this.queue.enqueueProcessingJob({
      jobId: job.id,
      projectId,
      stage: job.stage,
      trigger: autoGenerateAll ? "auto" : "manual",
    })

    return {
      project: await this.getProject(projectId),
      job,
    }
  }

  async getProjectStatus(id: string) {
    const project = await this.loadProjectSummary(id)
    return {
      id: project.id,
      status: project.status,
      currentStage: project.currentStage,
      progress: project.progress,
      updatedAt: project.updatedAt,
    }
  }

  async initUpload(
    projectId: string,
    input: {
      fileName: string
      fileSize: number
      mimeType: string
      kind: string
    }
  ) {
    if (input.fileSize > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException("Превышен лимит размера файла")
    }

    const sourceFileId = randomUUID()
    const storageKey = `source/${projectId}/${sourceFileId}/${input.fileName}`

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
      const projectResult = await client.query<Record<string, unknown>>(
        `select * from projects where id = $1 for update`,
        [projectId]
      )

      if (projectResult.rowCount === 0) {
        throw new NotFoundException("Проект не найден")
      }

      const project = projectResult.rows[0]
      const filesResult = await client.query<{ count: string }>(
        `select count(*)::text as count from source_files where project_id = $1`,
        [projectId]
      )

      const currentCount = Number(filesResult.rows[0]?.count ?? 0)
      if (currentCount >= MAX_FILES_PER_PROJECT) {
        throw new BadRequestException("Превышен лимит файлов в проекте")
      }

      const uploadId = randomUUID()
      const bucket = process.env.S3_BUCKET ?? DEFAULT_S3_BUCKET

      await client.query(
        `
        insert into source_files (
          id, project_id, original_name, mime_type, size_bytes, storage_key, upload_status, processing_status, kind, position, created_at
        ) values (
          $1, $2, $3, $4, $5, $6, 'initiated', 'pending', $7, $8, now()
        )
      `,
        [
          sourceFileId,
          projectId,
          input.fileName,
          input.mimeType,
          input.fileSize,
          storageKey,
          input.kind,
          currentCount + 1,
        ]
      )

      await client.query(
        `
        insert into upload_sessions (
          id, project_id, source_file_id, s3_upload_id, status, created_at, completed_at, bucket, storage_key, original_name, mime_type, size_bytes, kind
        ) values (
          $1, $2, $3, $4, 'initiated', now(), null, $5, $6, $7, $8, $9, $10
        )
      `,
        [
          uploadId,
          projectId,
          sourceFileId,
          s3UploadId,
          bucket,
          storageKey,
          input.fileName,
          input.mimeType,
          input.fileSize,
          input.kind,
        ]
      )

      await client.query(
        `
        update projects
        set
          files = $2,
          status = 'uploaded',
          updated_at = now(),
          logs = $3::jsonb
        where id = $1
      `,
        [
          projectId,
          currentCount + 1,
          JSON.stringify([`Инициализирован upload для ${input.fileName}.`, ...(parseJson<string[]>(project.logs, []))].slice(0, 10)),
        ]
      )

      return {
        uploadId,
        projectId,
        sourceFileId,
        bucket,
        storageKey,
        partSize: 0,
        maxParts: Math.ceil(input.fileSize / (10 * 1024 * 1024)) || 1,
        uploadStatus: "initiated" as const,
      }
    })
  }

  async signUploadPart(uploadId: string, partNumber: number) {
    const session = await this.getUploadSession(uploadId)
    await this.db.query(`update upload_sessions set status = 'uploading' where id = $1`, [uploadId])
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
      await client.query(`update upload_sessions set status = 'completed', completed_at = now() where id = $1`, [
        uploadId,
      ])
      await client.query(
        `update source_files set upload_status = 'completed', processing_status = 'done' where id = $1`,
        [session.sourceFileId]
      )
      await client.query(
        `
        update projects
        set
          status = 'uploaded',
          updated_at = now(),
          logs = $2::jsonb
        where id = $1
      `,
        [
          session.projectId,
          JSON.stringify([
            `Загрузка ${session.originalName} завершена.`,
            ...(await this.getProjectLogs(session.projectId)),
          ].slice(0, 10)),
        ]
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
      await client.query(`update upload_sessions set status = 'aborted' where id = $1`, [uploadId])
      await client.query(`update source_files set upload_status = 'aborted' where id = $1`, [
        session.sourceFileId,
      ])
      await client.query(`update projects set updated_at = now() where id = $1`, [session.projectId])
    })

    return {
      uploadId,
      status: "aborted" as const,
    }
  }

  async listArtifacts(projectId: string) {
    const result = await this.db.query<Record<string, unknown>>(
      `select * from artifacts where project_id = $1 order by stage, format`,
      [projectId]
    )
    return result.rows.map(mapArtifactRow)
  }

  async getArtifact(projectId: string, artifactId: string) {
    const result = await this.db.query<Record<string, unknown>>(
      `select * from artifacts where project_id = $1 and id = $2 limit 1`,
      [projectId, artifactId]
    )

    const row = result.rows[0]
    if (!row) {
      throw new NotFoundException("Артефакт не найден")
    }

    return mapArtifactRow(row)
  }

  async updateArtifact(projectId: string, artifactId: string, contentMd: string) {
    const artifact = await this.getArtifact(projectId, artifactId)

    await this.db.query(
      `
      update artifacts
      set content_md = $3, content_json = $4::jsonb, updated_at = now()
      where project_id = $1 and id = $2
    `,
      [
        projectId,
        artifactId,
        contentMd,
        JSON.stringify({ stage: artifact.stage, markdown: contentMd }),
      ]
    )

    await this.appendProjectLog(projectId, `Сохранена последняя версия этапа ${artifact.stage}.`)
    return this.getArtifact(projectId, artifactId)
  }

  async approveArtifact(projectId: string, artifactId: string) {
    const artifact = await this.getArtifact(projectId, artifactId)
    const project = await this.loadProjectSummary(projectId)
    const nextStage = stageOrder[stageOrder.indexOf(artifact.stage) + 1]
    const reviewId = randomUUID()
    const now = nowIso()

    await this.db.transaction(async (client) => {
      await client.query(
        `
        insert into stage_reviews (
          id, project_id, stage, source_artifact_id, edited_artifact_id, approved_at
        ) values (
          $1, $2, $3, $4, $5, now()
        )
        on conflict (project_id, stage) do update
        set source_artifact_id = excluded.source_artifact_id,
            edited_artifact_id = excluded.edited_artifact_id,
            approved_at = excluded.approved_at
      `,
        [reviewId, projectId, artifact.stage, artifact.id, artifact.id]
      )

      if (nextStage) {
        await client.query(
          `
          update projects
          set
            current_stage = $2,
            status = 'processing',
            progress = $3,
            updated_at = now(),
            logs = $4::jsonb
          where id = $1
        `,
          [
            projectId,
            nextStage,
            progressFor(nextStage, "processing"),
            JSON.stringify([`Этап ${artifact.stage} подтвержден.`, ...(project.logs ?? [])].slice(0, 10)),
          ]
        )

        await client.query(
          `
          insert into processing_jobs (
            id, project_id, stage, status, payload_json, result_json, error_text, started_at, finished_at, created_at
          ) values (
            $1, $2, $3, 'queued', $4::jsonb, null, null, null, null, now()
          )
        `,
          [
            randomUUID(),
            projectId,
            nextStage,
            JSON.stringify({
              stage: nextStage,
              trigger: "manual",
              promptKeys: promptKeysForStage(nextStage),
            }),
          ]
        )
      } else {
        await client.query(
          `
          update projects
          set
            current_stage = $2,
            status = 'completed',
            progress = 100,
            updated_at = now(),
            logs = $4::jsonb
          where id = $1
        `,
          [
            projectId,
            artifact.stage,
            100,
            JSON.stringify([`Этап ${artifact.stage} подтвержден.`, ...(project.logs ?? [])].slice(0, 10)),
          ]
        )
      }
    })

    if (nextStage) {
      const queuedJob = await this.getLatestQueuedJob(projectId, nextStage)
      if (queuedJob) {
        await this.queue.enqueueProcessingJob({
          jobId: queuedJob.id,
          projectId,
          stage: nextStage,
          trigger: "manual",
        })
      }
    }

    return {
      review: {
        id: reviewId,
        projectId,
        stage: artifact.stage,
        sourceArtifactId: artifact.id,
        editedArtifactId: artifact.id,
        approvedAt: now,
      },
      nextStage: nextStage ?? null,
      project: await this.getProject(projectId),
    }
  }

  async listJobs(projectId: string) {
    const result = await this.db.query<Record<string, unknown>>(
      `select * from processing_jobs where project_id = $1 order by created_at desc`,
      [projectId]
    )
    return result.rows.map(mapJobRow)
  }

  async retryJob(projectId: string, jobId: string) {
    const result = await this.db.query<Record<string, unknown>>(
      `select * from processing_jobs where project_id = $1 and id = $2 limit 1`,
      [projectId, jobId]
    )
    const row = result.rows[0]
    if (!row) {
      throw new NotFoundException("Job не найден")
    }

    await this.db.transaction(async (client) => {
      await client.query(
        `
        update processing_jobs
        set status = 'queued', started_at = null, finished_at = null, error_text = null
        where id = $1
      `,
        [jobId]
      )
      await client.query(
        `
        update projects
        set status = 'processing', updated_at = now(), logs = $2::jsonb
        where id = $1
      `,
        [projectId, JSON.stringify([`Повторный запуск job ${String(row.stage)}.`, ...(await this.getProjectLogs(projectId))].slice(0, 10))]
      )
    })

    await this.db.query(
      `
      update processing_jobs
      set payload_json = $2::jsonb
      where id = $1
      `,
      [
        jobId,
        JSON.stringify({
          stage: String(row.stage),
          trigger: "retry",
          promptKeys: promptKeysForStage(String(row.stage) as StageId),
        }),
      ]
    )

    await this.queue.enqueueProcessingJob({
      jobId,
      projectId,
      stage: String(row.stage) as StageId,
      trigger: "retry",
    })

    return this.getJob(projectId, jobId)
  }

  async downloadProject(projectId: string) {
    const artifacts: ArtifactRecord[] = await this.listArtifacts(projectId)
    const endpoint = process.env.S3_ENDPOINT ?? DEFAULT_S3_ENDPOINT
    const bucket = process.env.S3_BUCKET ?? DEFAULT_S3_BUCKET

    return artifacts.map((artifact) => ({
      id: artifact.id,
      stage: artifact.stage,
      format: artifact.format,
      storageKey: artifact.storageKey,
      downloadUrl: `${endpoint}/${bucket}/${artifact.storageKey}`,
    }))
  }

  private async loadProjectSummary(id: string) {
    const result = await this.db.query<Record<string, unknown>>(`select * from projects where id = $1 limit 1`, [id])
    const row = result.rows[0]
    if (!row) {
      throw new NotFoundException("Проект не найден")
    }
    const [sourceFiles, jobs] = await Promise.all([
      this.listSourceFiles(id),
      this.listJobs(id),
    ])
    return mapProjectRow(row, sourceFiles, jobs)
  }

  private async loadProjectDetail(id: string) {
    const project = await this.loadProjectSummary(id)
    const [artifacts, jobs, reviews] = await Promise.all([
      this.listArtifacts(id),
      this.listJobs(id),
      this.listReviews(id),
    ])
    return {
      ...project,
      artifacts,
      jobs,
      reviews,
    }
  }

  private async listSourceFiles(projectId: string) {
    const result = await this.db.query<Record<string, unknown>>(
      `select * from source_files where project_id = $1 order by position asc`,
      [projectId]
    )
    return result.rows.map(mapSourceFileRow)
  }

  private async listReviews(projectId: string) {
    const result = await this.db.query<Record<string, unknown>>(
      `select * from stage_reviews where project_id = $1 order by approved_at desc`,
      [projectId]
    )
    return result.rows.map(mapReviewRow)
  }

  private async getUploadSession(uploadId: string) {
    const result = await this.db.query<Record<string, unknown>>(
      `select * from upload_sessions where id = $1 limit 1`,
      [uploadId]
    )
    const row = result.rows[0]
    if (!row) {
      throw new NotFoundException("Upload session не найдена")
    }
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      sourceFileId: String(row.source_file_id),
      s3UploadId: String(row.s3_upload_id),
      status: String(row.status) as UploadStatus,
      createdAt: String(row.created_at),
      completedAt: (row.completed_at as string | null) ?? null,
      bucket: String(row.bucket),
      storageKey: String(row.storage_key),
      originalName: String(row.original_name),
      mimeType: String(row.mime_type),
      sizeBytes: Number(row.size_bytes),
      kind: String(row.kind),
    } satisfies UploadSessionRecord
  }

  private async getJob(projectId: string, jobId: string) {
    const result = await this.db.query<Record<string, unknown>>(
      `select * from processing_jobs where project_id = $1 and id = $2 limit 1`,
      [projectId, jobId]
    )
    const row = result.rows[0]
    if (!row) {
      throw new NotFoundException("Job не найден")
    }
    return mapJobRow(row)
  }

  private async getProjectLogs(projectId: string) {
    const result = await this.db.query<Record<string, unknown>>(
      `select logs from projects where id = $1 limit 1`,
      [projectId]
    )
    const row = result.rows[0]
    return parseJson<string[]>(row?.logs, [])
  }

  private async appendProjectLog(projectId: string, message: string) {
    const logs = [message, ...(await this.getProjectLogs(projectId))].slice(0, 10)
    await this.db.query(
      `update projects set logs = $2::jsonb, updated_at = now() where id = $1`,
      [projectId, JSON.stringify(logs)]
    )
  }

  private async getLatestQueuedJob(projectId: string, stage: StageId) {
    const result = await this.db.query<Record<string, unknown>>(
      `
      select *
      from processing_jobs
      where project_id = $1 and stage = $2 and status = 'queued'
      order by created_at desc
      limit 1
    `,
      [projectId, stage]
    )

    const row = result.rows[0]
    return row ? mapJobRow(row) : null
  }
}
