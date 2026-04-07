export const stageOrder = [
  "source_compiled",
  "course_outline",
  "course_content",
  "course_test",
] as const

export const stageLabels: Record<StageId, string> = {
  source_compiled: "Структурированный источник",
  course_outline: "План курса",
  course_content: "Обучающие материалы",
  course_test: "Тест",
}

export const projectStatusLabels: Record<ProjectStatus, string> = {
  draft: "Черновик",
  uploaded: "Загружен",
  processing: "В обработке",
  awaiting_review: "На проверке",
  completed: "Готов",
  failed: "Ошибка",
}

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

export type ApiEnvelope<T> = {
  success: boolean
  data: T
  error: string | null
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

export interface ProjectStageRecord {
  id: StageId
  status: JobStatus
  note: string
  updatedAt: string
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

export interface PaginatedProjects {
  items: ProjectRecord[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface ProjectStatusRecord {
  id: string
  status: ProjectStatus
  currentStage: StageId
  progress: number
  updatedAt: string
}

export interface UploadInitResponse {
  uploadId: string
  projectId: string
  sourceFileId: string
  bucket: string
  storageKey: string
  partSize: number
  maxParts: number
  uploadStatus: UploadStatus
}

export interface SignedUploadPart {
  uploadId: string
  partNumber: number
  signedUrl: string
  method: string
  headers: Record<string, string>
}

export interface CompletedUpload {
  uploadId: string
  status: "completed"
  storageKey: string
  completedAt: string
}

export interface AbortedUpload {
  uploadId: string
  status: "aborted"
}

export interface DownloadItem {
  id: string
  stage: StageId
  format: ArtifactFormat
  storageKey: string
  downloadUrl: string
}

const DEFAULT_HEADERS = {
  "content-type": "application/json",
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...DEFAULT_HEADERS,
      ...(init?.headers ?? {}),
    },
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

export async function listProjects(page: number, limit: number) {
  return requestJson<PaginatedProjects>(`/api/projects?page=${page}&limit=${limit}`)
}

export async function getProject(projectId: string) {
  return requestJson<ProjectDetailRecord>(`/api/projects/${projectId}`)
}

export async function createProject(input: {
  name?: string
  githubRef?: string
  note?: string
}) {
  return requestJson<ProjectDetailRecord>(`/api/projects`, {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function startProject(projectId: string) {
  return requestJson<{ project: ProjectDetailRecord; job: ProcessingJobRecord }>(
    `/api/projects/${projectId}/start`,
    {
      method: "POST",
    }
  )
}

export async function getProjectStatus(projectId: string) {
  return requestJson<ProjectStatusRecord>(`/api/projects/${projectId}/status`)
}

export async function initUpload(
  projectId: string,
  input: {
    fileName: string
    fileSize: number
    mimeType: string
    kind: string
  }
) {
  return requestJson<UploadInitResponse>(`/api/projects/${projectId}/uploads/init`, {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function signUploadPart(uploadId: string, partNumber: number) {
  return requestJson<SignedUploadPart>(`/api/uploads/${uploadId}/parts/sign`, {
    method: "POST",
    body: JSON.stringify({ partNumber }),
  })
}

export async function completeUpload(uploadId: string) {
  return requestJson<CompletedUpload>(`/api/uploads/${uploadId}/complete`, {
    method: "POST",
  })
}

export async function abortUpload(uploadId: string) {
  return requestJson<AbortedUpload>(`/api/uploads/${uploadId}/abort`, {
    method: "POST",
  })
}

export async function listArtifacts(projectId: string) {
  return requestJson<ArtifactRecord[]>(`/api/projects/${projectId}/artifacts`)
}

export async function updateArtifact(
  projectId: string,
  artifactId: string,
  contentMd: string
) {
  return requestJson<ArtifactRecord>(`/api/projects/${projectId}/artifacts/${artifactId}`, {
    method: "PUT",
    body: JSON.stringify({ contentMd }),
  })
}

export async function approveArtifact(projectId: string, artifactId: string) {
  return requestJson<{
    review: StageReviewRecord
    nextStage: StageId | null
    project: ProjectDetailRecord
  }>(`/api/projects/${projectId}/artifacts/${artifactId}/approve`, {
    method: "POST",
  })
}

export async function listJobs(projectId: string) {
  return requestJson<ProcessingJobRecord[]>(`/api/projects/${projectId}/jobs`)
}

export async function retryJob(projectId: string, jobId: string) {
  return requestJson<ProcessingJobRecord>(`/api/projects/${projectId}/jobs/${jobId}/retry`, {
    method: "POST",
  })
}

export async function downloadProject(projectId: string) {
  return requestJson<DownloadItem[]>(`/api/projects/${projectId}/download`)
}
