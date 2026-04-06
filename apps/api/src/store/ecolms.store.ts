import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common"
import { randomUUID } from "node:crypto"

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

function buildStages(currentStage: StageId, status: ProjectStatus): ProjectStageRecord[] {
  const currentIndex = stageOrder.indexOf(currentStage)

  return stageOrder.map((stageId, index) => {
    const isCompleted = status === "completed" || index < currentIndex
    const isActive = index === currentIndex && status !== "completed"

    return {
      id: stageId,
      status: isCompleted ? "done" : isActive ? "processing" : "queued",
      note:
        stageId === "source_compiled"
          ? "Нормализация исходников и удаление шума."
          : stageId === "course_outline"
            ? "Строим структуру курса до 10 разделов."
            : stageId === "course_content"
              ? "Разворачиваем материалы в обучающий текст."
              : "Формируем базовый тест из 10 вопросов.",
      updatedAt: isCompleted || isActive ? "сегодня, 09:40" : "ожидает старта",
    }
  })
}

function buildArtifacts(projectId: string, stageDrafts: Record<StageId, string>): ArtifactRecord[] {
  return stageOrder.flatMap((stageId) => {
    const timestamp = nowIso()
    return [
      {
        id: `${projectId}-${stageId}-md`,
        projectId,
        stage: stageId,
        format: "md" as const,
        storageKey: `artifacts/${projectId}/${stageId}.md`,
        contentMd: stageDrafts[stageId],
        contentJson: { stage: stageId, markdown: stageDrafts[stageId] },
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: `${projectId}-${stageId}-json`,
        projectId,
        stage: stageId,
        format: "json" as const,
        storageKey: `artifacts/${projectId}/${stageId}.json`,
        contentMd: stageDrafts[stageId],
        contentJson: { stage: stageId, markdown: stageDrafts[stageId] },
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]
  })
}

function makeSeedProject(options: {
  id: string
  prefix: string
  githubRef: string
  sourceSummary: string
  topic: string
  overview: string
  status: ProjectStatus
  currentStage: StageId
  progress: number
  files: number
  updatedAt: string
  logs: string[]
}): ProjectDetailRecord {
  const name = `${options.prefix} ${options.id.split("-").at(-1)}`
  const stageDrafts = buildDrafts(name, options.topic)
  const sourceFiles: SourceFileRecord[] = Array.from({ length: options.files }, (_, index) => ({
    id: `${options.id}-file-${index + 1}`,
    projectId: options.id,
    originalName: `source-${index + 1}.${index % 2 === 0 ? "pdf" : "mp4"}`,
    mimeType: index % 2 === 0 ? "application/pdf" : "video/mp4",
    sizeBytes: 42_000_000,
    storageKey: `source/${options.id}/source-${index + 1}`,
    uploadStatus: "completed",
    processingStatus: "done",
    kind: index % 2 === 0 ? "document" : "video",
    position: index + 1,
    createdAt: nowIso(),
  }))

  return {
    id: options.id,
    name,
    githubRef: options.githubRef,
    sourceSummary: options.sourceSummary,
    status: options.status,
    currentStage: options.currentStage,
    progress: options.progress,
    files: options.files,
    updatedAt: options.updatedAt,
    overview: options.overview,
    stageDrafts,
    stages: buildStages(options.currentStage, options.status),
    logs: options.logs,
    sourceFiles,
    artifacts: buildArtifacts(options.id, stageDrafts),
    jobs: [
      {
        id: `${options.id}-job-1`,
        projectId: options.id,
        stage: options.currentStage,
        status: options.status === "completed" ? "done" : "processing",
        payloadJson: { stage: options.currentStage },
        resultJson: { status: options.status },
        errorText: null,
        startedAt: nowIso(),
        finishedAt: options.status === "completed" ? nowIso() : null,
        createdAt: nowIso(),
      },
    ],
    reviews: [],
  }
}

@Injectable()
export class EcolmsStore {
  private readonly projects = new Map<string, ProjectDetailRecord>()
  private readonly uploads = new Map<string, UploadSessionRecord>()

  constructor() {
    const seeds = [
      makeSeedProject({
        id: "eco-001",
        prefix: "EcoGlass sales enablement",
        githubRef: "github.com/pl-ecookna/EcoLMS/issues/218",
        sourceSummary: "Вебинар + PDF для отдела продаж",
        topic: "продаж светопрозрачных конструкций",
        overview:
          "Материал для менеджеров, которые ведут первые консультации и собирают потребности клиента.",
        status: "awaiting_review",
        currentStage: "course_outline",
        progress: 68,
        files: 3,
        updatedAt: "сегодня, 10:18",
        logs: [
          "Загрузка завершена без ошибок.",
          "Из видео извлечено аудио и отправлено в Whisper.",
          "Черновик source_compiled ожидает ручной проверки.",
        ],
      }),
      makeSeedProject({
        id: "eco-002",
        prefix: "Монтаж и сервис",
        githubRef: "github.com/pl-ecookna/EcoLMS/issues/227",
        sourceSummary: "DOC + видеозапись сервисного инструктажа",
        topic: "сервиса и монтажа",
        overview:
          "Пошаговый разбор типовых работ и контрольных чек-листов для полевой команды.",
        status: "processing",
        currentStage: "course_content",
        progress: 44,
        files: 2,
        updatedAt: "вчера, 16:05",
        logs: [
          "Очистка текста завершена.",
          "Сформирован план курса на 6 разделов.",
          "Генерация материалов сейчас в очереди.",
        ],
      }),
      makeSeedProject({
        id: "eco-003",
        prefix: "Производство и качество",
        githubRef: "github.com/pl-ecookna/EcoLMS/issues/233",
        sourceSummary: "PPTX, PDF и стенограмма созвона",
        topic: "производства и контроля качества",
        overview:
          "Материал для производственных мастеров с акцентом на контроль узлов и брак.",
        status: "uploaded",
        currentStage: "source_compiled",
        progress: 18,
        files: 4,
        updatedAt: "вчера, 12:48",
        logs: [
          "Файлы загружены в Beget S3.",
          "Проект готов к запуску обработки.",
          "Ожидается подтверждение от пользователя.",
        ],
      }),
      makeSeedProject({
        id: "eco-004",
        prefix: "Коммерческое предложение",
        githubRef: "github.com/pl-ecookna/EcoLMS/issues/240",
        sourceSummary: "PDF КП и дополнительная презентация",
        topic: "подготовки коммерческих предложений",
        overview:
          "Пакет материалов для ускоренной подготовки КП на основе реальных документов заказчика.",
        status: "completed",
        currentStage: "course_test",
        progress: 100,
        files: 5,
        updatedAt: "понедельник, 09:30",
        logs: [
          "Все этапы подтверждены.",
          "Итоговый пакет сформирован.",
          "Артефакты доступны для скачивания.",
        ],
      }),
    ]

    for (const project of seeds) {
      this.projects.set(project.id, project)
    }
  }

  health() {
    return {
      success: true,
      data: {
        status: "ok",
        projects: this.projects.size,
        uploads: this.uploads.size,
      },
      error: null,
    }
  }

  listProjects(page: number, limit: number) {
    const safeLimit = Math.max(1, Math.min(limit, 25))
    const safePage = Math.max(1, page)
    const items = [...this.projects.values()].sort((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : -1
    )
    const total = items.length
    const start = (safePage - 1) * safeLimit
    const pageItems = items.slice(start, start + safeLimit)

    return {
      items: pageItems.map((project) => this.toProjectSummary(project)),
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    }
  }

  getProject(id: string) {
    return this.ensureProject(id)
  }

  createProject(input: { githubRef: string; note?: string }) {
    const id = `eco-${String(this.projects.size + 1).padStart(3, "0")}`
    const name = `${makeNameFromGithubRef(input.githubRef)} ${String(this.projects.size + 1).padStart(2, "0")}`
    const stageDrafts = buildDrafts(name, input.note ?? "нового обучающего курса")

    const project: ProjectDetailRecord = {
      id,
      name,
      githubRef: input.githubRef,
      sourceSummary: input.note ?? "Новый проект, ожидающий загрузки материалов",
      status: "draft",
      currentStage: "source_compiled",
      progress: 0,
      files: 0,
      updatedAt: nowIso(),
      overview:
        "Создан новый проект. После загрузки файлов можно запускать обработку.",
      stageDrafts,
      stages: buildStages("source_compiled", "draft"),
      logs: ["Проект создан из GitHub-источника."],
      sourceFiles: [],
      artifacts: buildArtifacts(id, stageDrafts),
      jobs: [],
      reviews: [],
    }

    this.projects.set(id, project)
    return this.toProjectSummary(project)
  }

  startProject(id: string) {
    const project = this.ensureProject(id)

    if (project.sourceFiles.length === 0) {
      throw new BadRequestException("Проект нельзя запустить без загруженных файлов")
    }

    const job = this.createJob(project, project.currentStage, "processing")
    project.status = "processing"
    project.logs = [`Запуск обработки для этапа ${project.currentStage}.`, ...project.logs].slice(0, 10)
    project.updatedAt = nowIso()
    return { project: this.toProjectSummary(project), job }
  }

  getProjectStatus(id: string) {
    const project = this.ensureProject(id)
    return {
      id: project.id,
      status: project.status,
      currentStage: project.currentStage,
      progress: project.progress,
      updatedAt: project.updatedAt,
    }
  }

  initUpload(projectId: string, input: {
    fileName: string
    fileSize: number
    mimeType: string
    kind: string
  }) {
    const project = this.ensureProject(projectId)

    if (project.sourceFiles.length >= MAX_FILES_PER_PROJECT) {
      throw new BadRequestException("Превышен лимит файлов в проекте")
    }

    if (input.fileSize > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException("Превышен лимит размера файла")
    }

    const sourceFileId = randomUUID()
    const uploadId = randomUUID()
    const storageKey = `source/${projectId}/${sourceFileId}/${input.fileName}`
    const bucket = process.env.S3_BUCKET ?? "ecolms"

    const sourceFile: SourceFileRecord = {
      id: sourceFileId,
      projectId,
      originalName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.fileSize,
      storageKey,
      uploadStatus: "initiated",
      processingStatus: "pending",
      kind: input.kind,
      position: project.sourceFiles.length + 1,
      createdAt: nowIso(),
    }

    project.sourceFiles.push(sourceFile)
    project.files = project.sourceFiles.length
    project.status = "uploaded"
    project.updatedAt = nowIso()
    project.logs = [`Инициализирован upload для ${input.fileName}.`, ...project.logs].slice(0, 10)

    const session: UploadSessionRecord = {
      id: uploadId,
      projectId,
      sourceFileId,
      s3UploadId: randomUUID(),
      status: "initiated",
      createdAt: nowIso(),
      completedAt: null,
      bucket,
      storageKey,
      originalName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.fileSize,
      kind: input.kind,
    }

    this.uploads.set(uploadId, session)

    return {
      uploadId,
      projectId,
      sourceFileId,
      bucket,
      storageKey,
      partSize: 10 * 1024 * 1024,
      maxParts: 1000,
      uploadStatus: session.status,
    }
  }

  signUploadPart(uploadId: string, partNumber: number) {
    const session = this.ensureUpload(uploadId)
    const endpoint = process.env.S3_ENDPOINT ?? "https://s3.example.invalid"

    session.status = "uploading"

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

  completeUpload(uploadId: string) {
    const session = this.ensureUpload(uploadId)
    const project = this.ensureProject(session.projectId)
    const sourceFile = project.sourceFiles.find((file) => file.id === session.sourceFileId)

    if (!sourceFile) {
      throw new NotFoundException("Файл не найден")
    }

    sourceFile.uploadStatus = "completed"
    sourceFile.processingStatus = "done"
    session.status = "completed"
    session.completedAt = nowIso()
    project.status = "uploaded"
    project.updatedAt = nowIso()
    project.logs = [`Загрузка ${sourceFile.originalName} завершена.`, ...project.logs].slice(0, 10)

    return {
      uploadId,
      status: session.status,
      storageKey: session.storageKey,
      completedAt: session.completedAt,
    }
  }

  abortUpload(uploadId: string) {
    const session = this.ensureUpload(uploadId)
    const project = this.ensureProject(session.projectId)
    const sourceFile = project.sourceFiles.find((file) => file.id === session.sourceFileId)

    if (sourceFile) {
      sourceFile.uploadStatus = "aborted"
    }

    session.status = "aborted"
    project.updatedAt = nowIso()
    return {
      uploadId,
      status: session.status,
    }
  }

  listArtifacts(projectId: string) {
    const project = this.ensureProject(projectId)
    return project.artifacts
  }

  getArtifact(projectId: string, artifactId: string) {
    const project = this.ensureProject(projectId)
    const artifact = project.artifacts.find((entry) => entry.id === artifactId)
    if (!artifact) {
      throw new NotFoundException("Артефакт не найден")
    }

    return artifact
  }

  updateArtifact(projectId: string, artifactId: string, contentMd: string) {
    const project = this.ensureProject(projectId)
    const artifact = this.getArtifact(projectId, artifactId)
    artifact.contentMd = contentMd
    artifact.contentJson = { stage: artifact.stage, markdown: contentMd }
    artifact.updatedAt = nowIso()
    project.logs = [`Сохранена последняя версия этапа ${artifact.stage}.`, ...project.logs].slice(0, 10)
    project.updatedAt = nowIso()

    return artifact
  }

  approveArtifact(projectId: string, artifactId: string) {
    const project = this.ensureProject(projectId)
    const artifact = this.getArtifact(projectId, artifactId)
    const existingReview = project.reviews.find((review) => review.stage === artifact.stage)
    const review: StageReviewRecord = existingReview ?? {
      id: randomUUID(),
      projectId,
      stage: artifact.stage,
      sourceArtifactId: artifact.id,
      editedArtifactId: artifact.id,
      approvedAt: nowIso(),
    }

    review.approvedAt = nowIso()
    review.editedArtifactId = artifact.id
    review.sourceArtifactId = artifact.id

    if (!existingReview) {
      project.reviews.push(review)
    }

    const stageIndex = stageOrder.indexOf(artifact.stage)
    const nextStage = stageOrder[stageIndex + 1]
    const currentStageRecord = project.stages.find((entry) => entry.id === artifact.stage)
    if (currentStageRecord) {
      currentStageRecord.status = "done"
      currentStageRecord.updatedAt = "только что"
    }

    if (nextStage) {
      project.currentStage = nextStage
      project.status = "processing"
      const nextStageRecord = project.stages.find((entry) => entry.id === nextStage)
      if (nextStageRecord) {
        nextStageRecord.status = "processing"
        nextStageRecord.updatedAt = "ожидает генерации"
      }
      this.createJob(project, nextStage, "queued")
    } else {
      project.status = "completed"
      project.progress = 100
    }

    project.updatedAt = nowIso()
    project.logs = [`Этап ${artifact.stage} подтвержден.`, ...project.logs].slice(0, 10)

    return {
      review,
      nextStage: nextStage ?? null,
      project: this.toProjectSummary(project),
    }
  }

  listJobs(projectId: string) {
    const project = this.ensureProject(projectId)
    return project.jobs
  }

  retryJob(projectId: string, jobId: string) {
    const project = this.ensureProject(projectId)
    const job = project.jobs.find((entry) => entry.id === jobId)
    if (!job) {
      throw new NotFoundException("Job не найден")
    }

    job.status = "processing"
    job.startedAt = nowIso()
    job.finishedAt = null
    job.errorText = null
    project.status = "processing"
    project.updatedAt = nowIso()
    project.logs = [`Повторный запуск job ${job.stage}.`, ...project.logs].slice(0, 10)

    return job
  }

  downloadProject(projectId: string) {
    const project = this.ensureProject(projectId)
    return project.artifacts.map((artifact) => ({
      id: artifact.id,
      stage: artifact.stage,
      format: artifact.format,
      storageKey: artifact.storageKey,
      downloadUrl: `${process.env.S3_ENDPOINT ?? "https://s3.example.invalid"}/${process.env.S3_BUCKET ?? "ecolms"}/${artifact.storageKey}`,
    }))
  }

  private createJob(project: ProjectDetailRecord, stage: StageId, status: JobStatus) {
    const job: ProcessingJobRecord = {
      id: randomUUID(),
      projectId: project.id,
      stage,
      status,
      payloadJson: { stage },
      resultJson: null,
      errorText: null,
      startedAt: status === "queued" ? null : nowIso(),
      finishedAt: null,
      createdAt: nowIso(),
    }
    project.jobs.push(job)
    return job
  }

  private ensureProject(projectId: string) {
    const project = this.projects.get(projectId)
    if (!project) {
      throw new NotFoundException("Проект не найден")
    }
    return project
  }

  private ensureUpload(uploadId: string) {
    const upload = this.uploads.get(uploadId)
    if (!upload) {
      throw new NotFoundException("Upload session не найдена")
    }
    return upload
  }

  private toProjectSummary(project: ProjectDetailRecord): ProjectRecord {
    return {
      id: project.id,
      name: project.name,
      githubRef: project.githubRef,
      sourceSummary: project.sourceSummary,
      status: project.status,
      currentStage: project.currentStage,
      progress: project.progress,
      files: project.files,
      updatedAt: project.updatedAt,
      overview: project.overview,
      stageDrafts: project.stageDrafts,
      stages: project.stages,
      logs: project.logs,
      sourceFiles: project.sourceFiles,
    }
  }
}
