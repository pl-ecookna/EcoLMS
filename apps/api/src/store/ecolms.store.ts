import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common"
import { randomUUID } from "node:crypto"

import { PostgresService } from "../db/postgres.service"

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
  | "awaiting_review"
  | "completed"
  | "failed"
export type JobStatus = "queued" | "processing" | "done" | "failed"
export type UploadStatus = "initiated" | "uploading" | "completed" | "aborted"
export type ArtifactFormat = "md" | "json"

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

function nowIso() {
  return new Date().toISOString()
}

function makeNameFromGithubRef(githubRef: string) {
  const normalized = githubRef
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")
  const last = normalized.split("/").filter(Boolean).at(-1) ?? "project"
  return last.replace(/[-_]+/g, " ").trim()
}

function buildDrafts(name: string, topic: string): Record<StageId, string> {
  return {
    source_compiled: `# ${name}\n\n## Что уже известно\n- ${topic}\n- Совмещаем видео и документы в одном проекте.\n- Итог хранится только в S3.\n\n## Что удаляем\n- контакты, если они не нужны для обучения;\n- рекламный шум;\n- повторы из вебинаров.\n`,
    course_outline: `# План курса\n\n1. Введение в ${topic}\n2. Ключевые материалы\n3. Практика и примеры\n4. Типовые ошибки\n5. Проверка понимания\n`,
    course_content: `# Обучающие материалы\n\n## Раздел 1. Введение\nКратко объясняем, зачем нужен материал и кому он адресован.\n\n## Раздел 2. Практика\nДаём пошаговые инструкции без жаргона и лишних деталей.\n`,
    course_test: `# Тест\n\n1. Какой шаг следует после source_compiled?\n   - План курса\n   - Список файлов\n   - Архив проекта\n2. Сколько вопросов должно быть в тесте?\n   - 5\n   - 10\n   - 15\n`,
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

function buildStages(
  currentStage: StageId,
  status: ProjectStatus,
  updatedAt: string
): ProjectStageRecord[] {
  const currentIndex = stageOrder.indexOf(currentStage)

  return stageOrder.map((stageId, index) => {
    const isCompleted = status === "completed" || index < currentIndex
    const isActive = index === currentIndex && status !== "completed"
    const stageStatus: JobStatus = isCompleted
      ? "done"
      : isActive
        ? "processing"
        : "queued"

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
      updatedAt: isCompleted || isActive ? updatedAt : "ожидает старта",
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

function mapProjectRow(row: Record<string, unknown>, sourceFiles: SourceFileRecord[]): ProjectRecord {
  const currentStage = String(row.current_stage)
  const status = String(row.status)
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
      String(row.updated_at)
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
  constructor(private readonly db: PostgresService) {}

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
      const sourceFiles = await this.listSourceFiles(String(row.id))
      items.push(mapProjectRow(row, sourceFiles))
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

  async createProject(input: { githubRef: string; note?: string }) {
    const id = makeProjectId()
    const name = `${makeNameFromGithubRef(input.githubRef)} ${id.slice(-4)}`
    const sourceSummary = input.note ?? "Новый проект, ожидающий загрузки материалов"
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
          input.githubRef,
          sourceSummary,
          now,
          "Создан новый проект. После загрузки файлов можно запускать обработку.",
          JSON.stringify(stageDrafts),
          JSON.stringify(["Проект создан из GitHub-источника."]),
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
          $1, $2, $3, 'processing', $4::jsonb, null, null, now(), null, now()
        )
        returning *
      `,
        [randomUUID(), id, project.currentStage, JSON.stringify({ stage: project.currentStage })]
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

    return { project: await this.getProject(id), job }
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

      const sourceFileId = randomUUID()
      const uploadId = randomUUID()
      const storageKey = `source/${projectId}/${sourceFileId}/${input.fileName}`
      const bucket = process.env.S3_BUCKET ?? "ecolms"
      const s3UploadId = randomUUID()

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
        partSize: 10 * 1024 * 1024,
        maxParts: 1000,
        uploadStatus: "initiated" as const,
      }
    })
  }

  async signUploadPart(uploadId: string, partNumber: number) {
    const session = await this.getUploadSession(uploadId)
    await this.db.query(`update upload_sessions set status = 'uploading' where id = $1`, [uploadId])
    const endpoint = process.env.S3_ENDPOINT ?? "https://s3.example.invalid"

    return {
      uploadId,
      partNumber,
      signedUrl: `${endpoint}/${session.bucket}/${session.storageKey}?partNumber=${partNumber}&uploadId=${session.s3UploadId}`,
      method: "PUT",
      headers: {
        "content-type": session.mimeType,
      },
    }
  }

  async completeUpload(uploadId: string) {
    const session = await this.getUploadSession(uploadId)

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
          [randomUUID(), projectId, nextStage, JSON.stringify({ stage: nextStage, trigger: "approval" })]
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
        set status = 'processing', started_at = now(), finished_at = null, error_text = null
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

    return this.getJob(projectId, jobId)
  }

  async downloadProject(projectId: string) {
    const artifacts: ArtifactRecord[] = await this.listArtifacts(projectId)
    const endpoint = process.env.S3_ENDPOINT ?? "https://s3.example.invalid"
    const bucket = process.env.S3_BUCKET ?? "ecolms"

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
    const sourceFiles = await this.listSourceFiles(id)
    return mapProjectRow(row, sourceFiles)
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
}
