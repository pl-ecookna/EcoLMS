export const stageOrder = [
  "source_compiled",
  "course_outline",
  "course_content",
  "course_test",
] as const

export const meetingStageOrder = [
  "audio_prepared",
  "transcript_compiled",
  "meeting_summary",
  "meeting_protocol",
  "meeting_actions",
] as const

export const stageLabels: Record<StageId, string> = {
  source_compiled: "Источник",
  course_outline: "План курса",
  course_content: "Обучающие материалы",
  course_test: "Тест",
}

export const meetingStageLabels: Record<MeetingStageId, string> = {
  audio_prepared: "Аудио",
  transcript_compiled: "Транскрипт",
  meeting_summary: "Сводка",
  meeting_protocol: "Протокол",
  meeting_actions: "Действия",
}

export const projectStatusLabels: Record<ProjectStatus, string> = {
  draft: "Черновик",
  uploaded: "Создан",
  processing: "В обработке",
  completed: "Готов",
  failed: "Ошибка",
}

export type StageId = (typeof stageOrder)[number]
export type MeetingStageId = (typeof meetingStageOrder)[number]
export type ProjectStatus =
  | "draft"
  | "uploaded"
  | "processing"
  | "completed"
  | "failed"
export type JobStatus = "queued" | "processing" | "done" | "failed"
export type UploadStatus = "initiated" | "uploading" | "completed" | "aborted"
export type ArtifactFormat = "md" | "json"
export type MeetingStatus = "draft" | "uploaded" | "processing" | "completed" | "failed"
export type PromptModule = "lms" | "meetings"
export type AppRole = "admin" | "editor"

export type ApiEnvelope<T> = {
  success: boolean
  data: T
  error: string | null
}

export interface AuthUser {
  id: string
  email: string
  name: string
  role: AppRole
  roles: string[]
}

export interface AuthMeResponse {
  user: AuthUser | null
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

export type ServiceHealthStatus = "up" | "down" | "degraded" | "unknown"

export interface ServiceHealthState {
  status: ServiceHealthStatus
  details: string
  checkedAt: string
}

export interface SystemHealthRecord {
  status: ServiceHealthStatus
  service: "api"
  timestamp: string
  speechProviderName: string
  services: {
    api: ServiceHealthState
    postgres: ServiceHealthState
    redis: ServiceHealthState
    llm: ServiceHealthState
    speechProvider: ServiceHealthState
    worker: ServiceHealthState
    transcriptionService: ServiceHealthState
  }
  stats: {
    projects: number
    uploads: number
  }
}

export interface PromptRecord {
  module: PromptModule
  promptKey: string
  title: string
  systemPrompt: string
  userPromptTemplate: string
  createdAt: string
  updatedAt: string
}

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
  stage: MeetingStageId
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

export interface PaginatedMeetings {
  items: MeetingListRecord[]
  total: number
  page: number
  limit: number
  totalPages: number
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

export async function getAuthMe() {
  const response = await fetch("/api/auth/me", {
    cache: "no-store",
  })
  if (!response.ok) {
    throw new Error("Не удалось восстановить текущую сессию")
  }
  return (await response.json()) as AuthMeResponse
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

export async function updateProject(
  projectId: string,
  input: {
    name?: string
    note?: string
  }
) {
  return requestJson<ProjectDetailRecord>(`/api/projects/${projectId}`, {
    method: "PATCH",
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

export async function generateStage(
  projectId: string,
  input: {
    stage: "source_compiled" | "course_outline" | "course_content" | "course_test"
    autoGenerateAll?: boolean
    overwriteExisting?: boolean
  }
) {
  return requestJson<{ project: ProjectDetailRecord; job: ProcessingJobRecord }>(
    `/api/projects/${projectId}/generate`,
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  )
}

export async function getProjectStatus(projectId: string) {
  return requestJson<ProjectStatusRecord>(`/api/projects/${projectId}/status`)
}

export async function getSystemHealth() {
  return requestJson<SystemHealthRecord>(`/api/health`)
}

export async function listPrompts(module?: PromptModule) {
  const suffix = module ? `?module=${module}` : ""
  return requestJson<PromptRecord[]>(`/api/prompts${suffix}`)
}

export async function updatePrompt(
  module: PromptModule,
  promptKey: string,
  input: {
    title?: string
    systemPrompt?: string
    userPromptTemplate?: string
  }
) {
  return requestJson<PromptRecord>(`/api/prompts/${module}/${promptKey}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })
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

export async function deleteSourceFile(projectId: string, sourceFileId: string) {
  return requestJson<ProjectDetailRecord>(
    `/api/projects/${projectId}/source-files/${sourceFileId}`,
    {
      method: "DELETE",
    }
  )
}

export async function deleteProject(projectId: string) {
  return requestJson<{ id: string; deleted: true }>(`/api/projects/${projectId}`, {
    method: "DELETE",
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

export async function listMeetings(page: number, limit: number) {
  return requestJson<PaginatedMeetings>(`/api/meetings?page=${page}&limit=${limit}`)
}

export async function createMeeting(input: { title?: string; description?: string }) {
  return requestJson<MeetingDetailRecord>(`/api/meetings`, {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function getMeeting(meetingId: string) {
  return requestJson<MeetingDetailRecord>(`/api/meetings/${meetingId}`)
}

export async function initMeetingUpload(
  meetingId: string,
  input: {
    fileName: string
    fileSize: number
    mimeType: string
  }
) {
  return requestJson<UploadInitResponse>(`/api/meetings/${meetingId}/uploads/init`, {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function signMeetingUploadPart(uploadId: string, partNumber: number) {
  return requestJson<SignedUploadPart>(`/api/meeting-uploads/${uploadId}/parts/sign`, {
    method: "POST",
    body: JSON.stringify({ partNumber }),
  })
}

export async function completeMeetingUpload(uploadId: string) {
  return requestJson<CompletedUpload>(`/api/meeting-uploads/${uploadId}/complete`, {
    method: "POST",
  })
}

export async function abortMeetingUpload(uploadId: string) {
  return requestJson<AbortedUpload>(`/api/meeting-uploads/${uploadId}/abort`, {
    method: "POST",
  })
}

export async function startMeeting(meetingId: string) {
  return requestJson<{ meeting: MeetingDetailRecord; job: MeetingJobRecord }>(
    `/api/meetings/${meetingId}/start`,
    {
      method: "POST",
    }
  )
}

export async function generateMeetingStage(
  meetingId: string,
  input: {
    stage: Exclude<MeetingStageId, "audio_prepared">
    overwriteExisting?: boolean
  }
) {
  return requestJson<{ meeting: MeetingDetailRecord; job: MeetingJobRecord }>(
    `/api/meetings/${meetingId}/generate`,
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  )
}

export async function deleteMeeting(meetingId: string) {
  return requestJson<{ id: string; deleted: true }>(`/api/meetings/${meetingId}`, {
    method: "DELETE",
  })
}

export async function getMeetingTranscript(meetingId: string) {
  return requestJson<{
    meetingId: string
    speakers: MeetingSpeakerRecord[]
    segments: MeetingSpeakerSegmentRecord[]
  }>(`/api/meetings/${meetingId}/transcript`)
}

export async function updateMeetingSpeaker(
  meetingId: string,
  speakerId: string,
  displayName: string
) {
  return requestJson<MeetingSpeakerRecord>(
    `/api/meetings/${meetingId}/speakers/${speakerId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ displayName }),
    }
  )
}

export async function listMeetingArtifacts(meetingId: string) {
  return requestJson<MeetingArtifactRecord[]>(`/api/meetings/${meetingId}/artifacts`)
}

export async function listMeetingJobs(meetingId: string) {
  return requestJson<MeetingJobRecord[]>(`/api/meetings/${meetingId}/jobs`)
}

export async function downloadMeeting(meetingId: string) {
  return requestJson<
    Array<{
      id: string
      type: MeetingStageId
      format: ArtifactFormat
      fileName: string
      downloadUrl: string
    }>
  >(`/api/meetings/${meetingId}/download`)
}
