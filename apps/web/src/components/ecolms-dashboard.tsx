"use client"

import { useEffect, useRef, useState, type DragEvent } from "react"
import Link from "next/link"
import {
  ActivityIcon,
  AlertCircleIcon,
  CheckCircle2Icon,
  DatabaseIcon,
  FileTextIcon,
  PencilIcon,
  Loader2Icon,
  MicIcon,
  MoreHorizontalIcon,
  PlusIcon,
  ServerCogIcon,
  SaveIcon,
  SparklesIcon,
  XCircleIcon,
  WandSparklesIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { UserMenu } from "@/components/user-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

import {
  abortUpload,
  type AuthUser,
  completeUpload,
  createProject,
  deleteProject,
  deleteSourceFile,
  generateStage,
  getProject,
  getSystemHealth,
  initUpload,
  listProjects,
  projectStatusLabels,
  type ServiceHealthState,
  type ServiceHealthStatus,
  type SystemHealthRecord,
  signUploadPart,
  stageLabels,
  updateArtifact,
  updateProject,
  type ProjectDetailRecord,
  type ProjectRecord,
  type ProjectStatus,
  type StageId,
} from "@/lib/ecolms-api"

const PAGE_SIZE = 25
const PART_SIZE_BYTES = 10 * 1024 * 1024
const MAX_CREATE_FILES = 5
const CREATE_FILES_ACCEPT =
  ".pdf,.ppt,.pptx,.doc,.docx,.txt,.md,.rtf,.mp3,.wav,.m4a,.aac,.ogg,.flac,.mp4,.mov,.avi,.mkv,.webm,.mpeg,.mpg"

const SUPPORTED_CREATE_EXTENSIONS = new Set([
  "pdf",
  "ppt",
  "pptx",
  "doc",
  "docx",
  "txt",
  "md",
  "rtf",
  "mp3",
  "wav",
  "m4a",
  "aac",
  "ogg",
  "flac",
  "mp4",
  "mov",
  "avi",
  "mkv",
  "webm",
  "mpeg",
  "mpg",
])

type GenerationStage =
  | "source_compiled"
  | "course_outline"
  | "course_content"
  | "course_test"
const VISIBLE_STAGES: GenerationStage[] = [
  "source_compiled",
  "course_outline",
  "course_content",
  "course_test",
]

type UploadPhase = "idle" | "uploading" | "done" | "error"
type UploadContext = "create" | "detail" | null
type UiAlertType = "success" | "error" | "info"

type UiAlert = {
  id: string
  type: UiAlertType
  title: string
  description?: string
}

function projectStatusBadgeVariant(
  status: ProjectStatus
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "draft":
      return "outline"
    case "uploaded":
      return "secondary"
    case "processing":
      return "default"
    case "completed":
      return "default"
    case "failed":
      return "destructive"
  }
}

function displayProjectStatus(
  project: Pick<ProjectRecord, "status" | "stages">
): ProjectStatus {
  if (project.status === "failed") {
    return "failed"
  }

  const hasProcessingStage = project.stages.some((stage) => stage.status === "processing")
  const hasDoneStage = project.stages.some((stage) => stage.status === "done")
  const allStagesDone =
    project.stages.length > 0 && project.stages.every((stage) => stage.status === "done")

  if (allStagesDone) {
    return "completed"
  }
  if (hasProcessingStage || hasDoneStage) {
    return "processing"
  }

  return project.status
}

function fileKind(file: File) {
  if (file.type.startsWith("video/")) {
    return "video"
  }
  if (file.type.startsWith("audio/")) {
    return "audio"
  }
  if (file.type.includes("pdf") || file.name.toLowerCase().endsWith(".pdf")) {
    return "document"
  }
  if (
    file.name.toLowerCase().endsWith(".pptx") ||
    file.name.toLowerCase().endsWith(".ppt")
  ) {
    return "presentation"
  }
  return "document"
}

function getStageArtifact(project: ProjectDetailRecord | null, stage: StageId) {
  return project?.artifacts.find(
    (artifact) => artifact.stage === stage && artifact.format === "md"
  )
}

function getStageMarkdown(project: ProjectDetailRecord | null, stage: StageId) {
  return (
    getStageArtifact(project, stage)?.contentMd ?? project?.stageDrafts[stage] ?? ""
  )
}

function formatDateLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function getFileExtension(fileName: string) {
  const parts = fileName.toLowerCase().split(".")
  return parts.length > 1 ? parts[parts.length - 1] : ""
}

function isSupportedCreateFile(file: File) {
  if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
    return true
  }

  const extension = getFileExtension(file.name)
  return SUPPORTED_CREATE_EXTENSIONS.has(extension)
}

function isStageDone(project: ProjectDetailRecord | null, stage: StageId) {
  const stageStatus = project?.stages.find((item) => item.id === stage)?.status
  return stageStatus === "done"
}

function sourceFileStatusLabel(status: string) {
  switch (status) {
    case "completed":
      return "Загружен"
    case "uploading":
      return "Выгружается"
    case "aborted":
      return "Прерван"
    default:
      return "Ожидает"
  }
}

function serviceStatusLabel(status: ServiceHealthStatus) {
  switch (status) {
    case "up":
      return "Доступен"
    case "down":
      return "Недоступен"
    case "degraded":
      return "Проблемы"
    default:
      return "Неизвестно"
  }
}

function serviceStatusBadgeClass(status: ServiceHealthStatus) {
  switch (status) {
    case "up":
      return "border-emerald-200 bg-emerald-50 text-emerald-700"
    case "down":
      return "border-red-200 bg-red-50 text-red-700"
    case "degraded":
      return "border-amber-200 bg-amber-50 text-amber-700"
    default:
      return "border-border bg-muted text-muted-foreground"
  }
}

function serviceStatusIcon(status: ServiceHealthStatus) {
  switch (status) {
    case "up":
      return <CheckCircle2Icon className="size-4 text-emerald-600" />
    case "down":
      return <XCircleIcon className="size-4 text-red-600" />
    case "degraded":
      return <AlertCircleIcon className="size-4 text-amber-600" />
    default:
      return <ActivityIcon className="size-4 text-muted-foreground" />
  }
}

function serviceKindIcon(serviceKey: string) {
  if (serviceKey === "postgres") {
    return <DatabaseIcon className="size-4 text-muted-foreground" />
  }
  if (serviceKey === "redis") {
    return <ServerCogIcon className="size-4 text-muted-foreground" />
  }
  if (serviceKey === "llm") {
    return <SparklesIcon className="size-4 text-muted-foreground" />
  }
  if (serviceKey === "speechProvider") {
    return <MicIcon className="size-4 text-muted-foreground" />
  }
  if (serviceKey === "worker") {
    return <ActivityIcon className="size-4 text-muted-foreground" />
  }
  if (serviceKey === "transcriptionService") {
    return <ServerCogIcon className="size-4 text-muted-foreground" />
  }
  return <ActivityIcon className="size-4 text-muted-foreground" />
}

function MarkdownContent({ value }: { value: string }) {
  return (
    <div className="text-sm leading-6 text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="mb-4 text-2xl font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-3 mt-6 text-xl font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 mt-5 text-lg font-semibold">{children}</h3>,
          p: ({ children }) => <p className="mb-3">{children}</p>,
          ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-6">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-6">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="mb-3 border-l-2 border-border pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-border" />,
          code: ({ children }) => (
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em]">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="mb-3 overflow-x-auto rounded border bg-muted/40 p-3 font-mono text-xs leading-5">
              {children}
            </pre>
          ),
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  )
}

export function EcolmsDashboard({
  currentUser,
}: {
  currentUser: AuthUser
}) {
  const canManage = currentUser.role === "admin"
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [projectTotal, setProjectTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedProject, setSelectedProject] =
    useState<ProjectDetailRecord | null>(null)
  const [selectedStage, setSelectedStage] = useState<GenerationStage>("source_compiled")
  const [editorValue, setEditorValue] = useState("")
  const [isEditing, setIsEditing] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [courseName, setCourseName] = useState("")
  const [courseNote, setCourseNote] = useState("")
  const [createFiles, setCreateFiles] = useState<File[]>([])
  const [createDropActive, setCreateDropActive] = useState(false)
  const [createFilesError, setCreateFilesError] = useState<string | null>(null)
  const createFilesInputRef = useRef<HTMLInputElement | null>(null)
  const [detailFiles, setDetailFiles] = useState<File[]>([])
  const [regenerationContext, setRegenerationContext] = useState("")
  const [listLoading, setListLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [mutating, setMutating] = useState(false)
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle")
  const [uploadContext, setUploadContext] = useState<UploadContext>(null)
  const [uploadMessage, setUploadMessage] = useState("")
  const [uploadProgress, setUploadProgress] = useState(0)
  const [listError, setListError] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [generatingStage, setGeneratingStage] = useState<GenerationStage | null>(null)
  const [systemHealth, setSystemHealth] = useState<SystemHealthRecord | null>(null)
  const [sourcePreviewOpen, setSourcePreviewOpen] = useState(false)
  const [sourcePreviewLoading, setSourcePreviewLoading] = useState(false)
  const [sourcePreviewError, setSourcePreviewError] = useState<string | null>(null)
  const [sourcePreviewProjectName, setSourcePreviewProjectName] = useState("")
  const [sourcePreviewContent, setSourcePreviewContent] = useState("")
  const [alerts, setAlerts] = useState<UiAlert[]>([])

  const totalPages = Math.max(1, Math.ceil(projectTotal / PAGE_SIZE))
  const currentStageArtifact = getStageArtifact(selectedProject, selectedStage)
  const currentStageSourceValue = getStageMarkdown(selectedProject, selectedStage)
  const hasUnsavedChanges = Boolean(currentStageArtifact) && editorValue !== currentStageSourceValue
  function dismissAlert(id: string) {
    setAlerts((current) => current.filter((item) => item.id !== id))
  }

  function notify(type: UiAlertType, title: string, description?: string) {
    const id = crypto.randomUUID()
    setAlerts((current) => [...current, { id, type, title, description }])
    window.setTimeout(() => {
      dismissAlert(id)
    }, 5000)
  }

  async function refreshProjects(nextPage = page) {
    setListLoading(true)
    setListError(null)

    try {
      const response = await listProjects(nextPage, PAGE_SIZE)
      setProjects(response.items)
      setProjectTotal(response.total)
      setPage(response.page)

      if (response.items.length === 0) {
        setSelectedId(null)
        setSelectedProject(null)
        return response
      }

      if (!selectedId || !response.items.some((project) => project.id === selectedId)) {
        setSelectedId(response.items[0]?.id ?? null)
      }
      return response
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Не удалось загрузить курсы")
      return null
    } finally {
      setListLoading(false)
    }
  }

  async function refreshProject(projectId: string) {
    setDetailLoading(true)
    setDetailError(null)

    try {
      const response = await getProject(projectId)
      setSelectedProject(response)
      const firstVisible =
        (VISIBLE_STAGES.find((stage) => stage === response.currentStage) as
          | GenerationStage
          | undefined) ?? "course_outline"
      setSelectedStage(firstVisible)
      setEditorValue(getStageMarkdown(response, firstVisible))
      setIsEditing(false)
      return response
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Не удалось загрузить курс")
      throw error
    } finally {
      setDetailLoading(false)
    }
  }

  useEffect(() => {
    void refreshProjects(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false

    const refreshHealth = async () => {
      try {
        const health = await getSystemHealth()
        if (!cancelled) {
          setSystemHealth(health)
        }
      } catch {
        if (!cancelled) {
          setSystemHealth(null)
        }
      }
    }

    void refreshHealth()
    const intervalId = window.setInterval(() => {
      void refreshHealth()
    }, 15_000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    if (!selectedId) {
      return
    }

    void refreshProject(selectedId)
  }, [selectedId])

  useEffect(() => {
    if (!selectedProject) {
      setRegenerationContext("")
      return
    }
    setRegenerationContext(selectedProject.sourceSummary || "")
  }, [selectedProject])

  useEffect(() => {
    if (!selectedProject) {
      return
    }
    setEditorValue(getStageMarkdown(selectedProject, selectedStage))
  }, [selectedProject, selectedStage])

  useEffect(() => {
    if (!hasUnsavedChanges) {
      return
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }

    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [hasUnsavedChanges])

  useEffect(() => {
    const projectId = selectedProject?.id
    if (!projectId || hasUnsavedChanges) {
      return
    }

    let cancelled = false

    const pollProject = async () => {
      try {
        const detail = await getProject(projectId)
        if (cancelled) {
          return
        }

        setProjects((current) =>
          current.map((project) =>
            project.id === detail.id
              ? {
                  ...project,
                  status: detail.status,
                  currentStage: detail.currentStage,
                  progress: detail.progress,
                  updatedAt: detail.updatedAt,
                  stages: detail.stages,
                }
              : project
          )
        )
        setSelectedProject(detail)
      } catch {
        return
      }
    }

    void pollProject()
    const intervalId = window.setInterval(() => {
      void pollProject()
    }, 4000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [hasUnsavedChanges, selectedProject?.id])

  function confirmDiscardUnsavedChanges() {
    if (!hasUnsavedChanges) {
      return true
    }
    return window.confirm("Есть несохранённые изменения. Выйти без сохранения?")
  }

  function handleSelectProject(projectId: string) {
    if (projectId === selectedId) {
      if (!selectedProject || selectedProject.id !== projectId || detailError) {
        void refreshProject(projectId)
      }
      return true
    }
    if (!confirmDiscardUnsavedChanges()) {
      return false
    }
    setSelectedId(projectId)
    setIsEditing(false)
    return true
  }

  function handleSelectStage(stage: GenerationStage) {
    if (stage === selectedStage) {
      return true
    }
    if (!confirmDiscardUnsavedChanges()) {
      return false
    }
    setSelectedStage(stage)
    setIsEditing(false)
    return true
  }

  function resetUploadState() {
    setUploadPhase("idle")
    setUploadContext(null)
    setUploadMessage("")
    setUploadProgress(0)
  }

  function selectCreateFiles(nextFiles: File[]) {
    const rejected: string[] = []
    const merged = [...createFiles]

    for (const file of nextFiles) {
      if (!isSupportedCreateFile(file)) {
        rejected.push(file.name)
        continue
      }

      const alreadyExists = merged.some(
        (current) =>
          current.name === file.name &&
          current.size === file.size &&
          current.lastModified === file.lastModified
      )

      if (!alreadyExists) {
        merged.push(file)
      }
    }

    if (rejected.length) {
      setCreateFilesError(
        `Неподдерживаемые форматы: ${rejected.join(", ")}. Разрешены PDF, PPT/PPTX, DOC/DOCX, TXT/MD/RTF, аудио и видео.`
      )
    } else {
      setCreateFilesError(null)
    }

    if (merged.length > MAX_CREATE_FILES) {
      setCreateFilesError(`Можно добавить не более ${MAX_CREATE_FILES} файлов в курс`)
    }

    setCreateFiles(merged.slice(0, MAX_CREATE_FILES))
  }

  function removeCreateFile(target: File) {
    setCreateFiles((current) =>
      current.filter(
        (file) =>
          !(
            file.name === target.name &&
            file.size === target.size &&
            file.lastModified === target.lastModified
          )
      )
    )
    setCreateFilesError(null)
  }

  function handleCreateFilesDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setCreateDropActive(false)
    selectCreateFiles(Array.from(event.dataTransfer.files ?? []))
  }

  async function uploadFilesForProject(
    projectId: string,
    files: File[],
    context: Exclude<UploadContext, null>,
    nextPage = page
  ) {
    if (files.length === 0) {
      return
    }

    setUploadContext(context)
    setUploadPhase("uploading")
    setUploadMessage("Инициализируем загрузку файлов")
    setUploadProgress(0)

    const totalChunks = files.reduce(
      (sum, file) => sum + Math.max(1, Math.ceil(file.size / PART_SIZE_BYTES)),
      0
    )
    let completedChunks = 0

    try {
      for (const file of files) {
        const init = await initUpload(projectId, {
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || "application/octet-stream",
          kind: fileKind(file),
        })

        const partSize = init.partSize || PART_SIZE_BYTES
        const totalParts = Math.max(1, Math.ceil(file.size / partSize))

        try {
          const uploadedParts: Array<{ partNumber: number; etag: string }> = []
          for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
            const start = (partNumber - 1) * partSize
            const end = Math.min(file.size, partNumber * partSize)
            const part = file.slice(start, end)
            const signed = await signUploadPart(init.uploadId, partNumber)

            setUploadMessage(`Загружается ${file.name}: часть ${partNumber}/${totalParts}`)
            const response = await fetch(signed.signedUrl, {
              method: signed.method || "PUT",
              headers: signed.headers,
              body: part,
            })

            if (!response.ok) {
              throw new Error(`Не удалось загрузить часть ${partNumber} файла ${file.name}`)
            }

            const etag = response.headers.get("etag") ?? response.headers.get("ETag") ?? ""
            uploadedParts.push({ partNumber, etag })

            completedChunks += 1
            setUploadProgress(Math.round((completedChunks / totalChunks) * 100))
          }

          await completeUpload(init.uploadId, uploadedParts)
        } catch (error) {
          await abortUpload(init.uploadId).catch(() => undefined)
          throw error
        }
      }

      setUploadPhase("done")
      setUploadMessage("Файлы загружены")
      await refreshProjects(nextPage)
      await refreshProject(projectId)
      notify(
        "success",
        "Файлы загружены",
        files.length === 1
          ? `Добавлен файл: ${files[0]?.name ?? "файл"}.`
          : `Добавлено файлов: ${files.length}.`
      )
    } catch (error) {
      setUploadPhase("error")
      const message =
        error instanceof Error ? error.message : "Не удалось загрузить файлы"
      setUploadMessage(message)
      notify("error", "Ошибка загрузки файлов", message)
      throw error
    }
  }

  async function handleCreateCourse() {
    if (!courseName.trim()) {
      return
    }

    setMutating(true)
    setListError(null)

    try {
      const created = await createProject({
        name: courseName.trim(),
        note: courseNote.trim() || undefined,
      })

      setSelectedId(created.id)
      setSelectedProject(created)
      setPage(1)

      if (createFiles.length > 0) {
        await uploadFilesForProject(created.id, createFiles, "create", 1)
      } else {
        await refreshProjects(1)
        await refreshProject(created.id)
      }

      setCourseName("")
      setCourseNote("")
      setCreateFiles([])
      setCreateFilesError(null)
      setCreateDropActive(false)
      setCreateOpen(false)
      resetUploadState()
      notify("success", "Курс создан", `Курс «${created.name}» успешно создан.`)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Не удалось создать курс"
      setListError(message)
      notify("error", "Ошибка создания курса", message)
    } finally {
      setMutating(false)
    }
  }

  async function handleUploadFiles() {
    if (!selectedProject || detailFiles.length === 0) {
      return
    }

    try {
      await uploadFilesForProject(selectedProject.id, detailFiles, "detail", page)
      setDetailFiles([])
    } catch {
      return
    }
  }

  async function handleSaveDraft() {
    if (!selectedProject || !currentStageArtifact || !hasUnsavedChanges) {
      return
    }

    setMutating(true)
    try {
      await updateArtifact(selectedProject.id, currentStageArtifact.id, editorValue)
      await refreshProjects(page)
      await refreshProject(selectedProject.id)
      notify("success", "Изменения сохранены", `Этап «${stageLabels[selectedStage]}» обновлён.`)
    } finally {
      setMutating(false)
    }
  }

  async function handleDeleteProject(projectOverride?: Pick<ProjectRecord, "id" | "name">) {
    const targetProject = projectOverride ?? selectedProject
    if (!targetProject) {
      return
    }

    const confirmed = window.confirm(
      `Удалить курс "${targetProject.name}" целиком? Это действие нельзя отменить.`
    )
    if (!confirmed) {
      return
    }

    setMutating(true)
    try {
      await deleteProject(targetProject.id)
      notify("success", "Курс удалён", `Курс «${targetProject.name}» удалён.`)
      setIsEditing(false)
      const refreshed = await refreshProjects(page)

      if (targetProject.id === selectedId) {
        const topProjectId = refreshed?.items[0]?.id ?? null
        setSelectedId(topProjectId)
        if (!topProjectId) {
          setSelectedProject(null)
        }
      }
    } finally {
      setMutating(false)
    }
  }

  async function handleOpenStructuredSource(projectId: string, projectName: string) {
    setSourcePreviewOpen(true)
    setSourcePreviewLoading(true)
    setSourcePreviewError(null)
    setSourcePreviewProjectName(projectName)
    setSourcePreviewContent("")

    try {
      const detail = await getProject(projectId)
      setSourcePreviewProjectName(detail.name)
      setSourcePreviewContent(getStageMarkdown(detail, "source_compiled"))
    } catch (error) {
      setSourcePreviewError(
        error instanceof Error
          ? error.message
          : "Не удалось загрузить источник."
      )
    } finally {
      setSourcePreviewLoading(false)
    }
  }

  async function handleGenerateAllForProject(projectId: string) {
    if (!confirmDiscardUnsavedChanges()) {
      return
    }

    setMutating(true)
    setGeneratingStage("source_compiled")
    setListError(null)
    try {
      const projectDetail = await getProject(projectId)

      if (!projectDetail.sourceFiles.length) {
        const message = "Нельзя запустить авто-генерацию: сначала загрузите файлы курса."
        setListError(message)
        notify("error", "Автогенерация не запущена", message)
        return
      }

      await generateStage(projectId, {
        stage: "source_compiled",
        autoGenerateAll: true,
        overwriteExisting: false,
      })

      await refreshProjects(page)
      await refreshProject(projectId)
      setSelectedId(projectId)
      setIsEditing(false)
      setSelectedStage("source_compiled")
      notify("info", "Автогенерация запущена", "Запущена последовательная генерация этапов.")
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Не удалось запустить генерацию"
      setListError(message)
      notify("error", "Ошибка запуска автогенерации", message)
    } finally {
      setGeneratingStage(null)
      setMutating(false)
    }
  }

  async function handleSaveContext() {
    if (!selectedProject) {
      return
    }
    setMutating(true)
    try {
      await updateProject(selectedProject.id, { note: regenerationContext })
      await refreshProjects(page)
      await refreshProject(selectedProject.id)
      notify("success", "Контекст сохранён")
    } finally {
      setMutating(false)
    }
  }

  async function handleDeleteSourceFile(sourceFileId: string) {
    if (!selectedProject) {
      return
    }
    const confirmed = window.confirm("Удалить файл из курса?")
    if (!confirmed) {
      return
    }

    setMutating(true)
    try {
      await deleteSourceFile(selectedProject.id, sourceFileId)
      await refreshProjects(page)
      await refreshProject(selectedProject.id)
      notify("success", "Файл удалён из курса")
    } finally {
      setMutating(false)
    }
  }

  async function handleGenerate(stage: GenerationStage, autoGenerateAll = false) {
    if (!selectedProject) {
      return
    }

    const generatedAlready = isStageDone(selectedProject, stage)
    let overwriteExisting = false

    if (generatedAlready) {
      overwriteExisting = window.confirm(
        `Этап "${stageLabels[stage]}" уже создан. Перезаписать результат?`
      )
      if (!overwriteExisting) {
        return
      }
    }

    setMutating(true)
    setGeneratingStage(stage)
    setListError(null)
    try {
      await generateStage(selectedProject.id, {
        stage,
        autoGenerateAll,
        overwriteExisting,
      })
      await refreshProjects(page)
      await refreshProject(selectedProject.id)
      setIsEditing(false)
      setSelectedStage(stage)
      notify("info", "Генерация запущена", `Этап «${stageLabels[stage]}» запущен.`)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Не удалось запустить генерацию"
      setListError(message)
      notify("error", "Ошибка запуска генерации", message)
    } finally {
      setGeneratingStage(null)
      setMutating(false)
    }
  }

  const detailUploadVisible = uploadContext === "detail" && uploadPhase !== "idle"
  const createUploadVisible = uploadContext === "create" && uploadPhase !== "idle"

  const canGenerateSource = Boolean(selectedProject?.sourceFiles.length)
  const sourceTextReady = Boolean(getStageMarkdown(selectedProject, "source_compiled").trim())
  const sourceDone = isStageDone(selectedProject, "source_compiled")
  const canGenerateOutline = sourceDone && sourceTextReady
  const canGenerateContent =
    sourceDone && sourceTextReady && isStageDone(selectedProject, "course_outline")
  const canGenerateTest =
    sourceDone && sourceTextReady && isStageDone(selectedProject, "course_content")
  const stageInServerProcessing = (stage: GenerationStage) =>
    selectedProject?.status === "processing" && selectedProject.currentStage === stage
  const selectedStageIsProcessing =
    stageInServerProcessing(selectedStage) || (generatingStage === selectedStage && mutating)

  const generationLabelByStage: Record<GenerationStage, string> = {
    source_compiled: "Распознать материалы",
    course_outline: "Создать план",
    course_content: "Создать материалы",
    course_test: "Создать тест",
  }
  const overallHealthStatus: ServiceHealthStatus = systemHealth?.status ?? "unknown"
  const serviceEntries: Array<{
    key: keyof SystemHealthRecord["services"]
    title: string
    state: ServiceHealthState | null
  }> = [
    { key: "api", title: "API", state: systemHealth?.services.api ?? null },
    { key: "postgres", title: "Postgres", state: systemHealth?.services.postgres ?? null },
    { key: "redis", title: "Redis", state: systemHealth?.services.redis ?? null },
    { key: "llm", title: "LLM", state: systemHealth?.services.llm ?? null },
    {
      key: "speechProvider",
      title: systemHealth?.speechProviderName ?? "STT-провайдер",
      state: systemHealth?.services.speechProvider ?? null,
    },
    { key: "worker", title: "Worker", state: systemHealth?.services.worker ?? null },
    {
      key: "transcriptionService",
      title: "Transcription Service",
      state: systemHealth?.services.transcriptionService ?? null,
    },
  ]

  function isGenerateDisabled(stage: GenerationStage) {
    if (stageInServerProcessing(stage)) {
      return true
    }
    if (stage === "source_compiled") {
      return !canGenerateSource || mutating
    }
    if (stage === "course_outline") {
      return !canGenerateOutline || mutating
    }
    if (stage === "course_content") {
      return !canGenerateContent || mutating
    }
    return !canGenerateTest || mutating
  }

  function getGenerateBlockedReason(stage: GenerationStage) {
    if (stageInServerProcessing(stage)) {
      return "Этап сейчас в генерации. Дождитесь завершения."
    }
    if (mutating) {
      return "Дождитесь завершения текущей операции."
    }
    if (stage === "source_compiled" && !canGenerateSource) {
      return "Сначала загрузите исходные файлы курса."
    }
    if (stage === "course_outline" && !canGenerateOutline) {
      if (!sourceDone) {
        return "Сначала запустите и завершите этап «Источник»."
      }
      if (!sourceTextReady) {
        return "В этапе «Источник» должен быть текст перед генерацией плана."
      }
      return "Сначала подготовьте источник."
    }
    if (stage === "course_content" && !canGenerateContent) {
      if (!sourceDone || !sourceTextReady) {
        return "Сначала завершите и заполните этап «Источник»."
      }
      return "Сначала создайте план курса."
    }
    if (stage === "course_test" && !canGenerateTest) {
      if (!sourceDone || !sourceTextReady) {
        return "Сначала завершите и заполните этап «Источник»."
      }
      return "Сначала создайте обучающие материалы."
    }
    return null
  }

  return (
    <>
      <div className="min-h-screen bg-transparent">
        <div className="mx-auto flex min-h-screen w-full max-w-[1760px] flex-col gap-5 px-4 py-4 sm:px-6 lg:px-8">
          <header className="flex items-end justify-between gap-4 rounded-3xl border border-border/70 bg-card/95 px-6 py-6 shadow-sm">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                <SparklesIcon className="size-4" />
                EcoLMS
              </div>
              <h1 className="font-heading text-3xl font-semibold tracking-tight">
                Конструктор обучающих курсов
              </h1>
            </div>
            <HoverCard>
              <HoverCardTrigger
                render={
                  <button
                    type="button"
                    className={cn(
                      "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm shadow-sm",
                      serviceStatusBadgeClass(overallHealthStatus)
                    )}
                  />
                }
              >
                {serviceStatusIcon(overallHealthStatus)}
                <span>Сервисы: {serviceStatusLabel(overallHealthStatus)}</span>
              </HoverCardTrigger>
              <HoverCardContent align="end" side="bottom" className="min-w-80 max-w-96 space-y-3">
                <div className="space-y-1">
                  <div className="text-sm font-semibold">Доступность сервисов</div>
                  <div className="text-xs text-muted-foreground">
                    Обновлено: {systemHealth ? formatDateLabel(systemHealth.timestamp) : "нет данных"}
                  </div>
                </div>
                <div className="space-y-2">
                  {serviceEntries.map((entry) => {
                    const state = entry.state
                    const status = state?.status ?? "unknown"
                    return (
                      <div
                        key={entry.key}
                        className="flex items-start justify-between gap-3 rounded-xl border border-border/70 bg-card/95 px-3 py-2.5 shadow-sm"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2">
                            {serviceKindIcon(entry.key)}
                            <span className="text-sm font-medium">{entry.title}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {state?.details ?? "Нет данных"}
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn("shrink-0", serviceStatusBadgeClass(status))}
                        >
                          {serviceStatusLabel(status)}
                        </Badge>
                      </div>
                    )
                  })}
                </div>
              </HoverCardContent>
            </HoverCard>
            <div className="flex items-center gap-2">
              <Link
                href="/meetings"
                prefetch={false}
                className={buttonVariants({ variant: "outline", size: "sm" })}
                onClick={(event) => {
                  event.preventDefault()
                  window.location.assign("/meetings")
                }}
              >
                Модуль встреч
              </Link>
              <UserMenu
                user={currentUser}
                promptsHref={canManage ? "/prompts?module=lms&from=lms" : null}
              />
            </div>
          </header>

          {listError ? (
            <Alert>
              <AlertCircleIcon />
              <AlertTitle>Ошибка операции</AlertTitle>
              <AlertDescription>{listError}</AlertDescription>
            </Alert>
          ) : null}

          <section className="grid flex-1 grid-cols-[420px_minmax(0,1fr)] items-stretch gap-4">
            <Card className="flex h-full min-h-[720px] flex-col overflow-hidden border-border/70 bg-card/95 shadow-sm">
              <CardHeader className="border-b border-border/70 bg-muted/35">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle>Курсы</CardTitle>
                    <CardDescription>Список курсов и текущий статус.</CardDescription>
                  </div>
                  <Button onClick={() => setCreateOpen(true)}>
                    <PlusIcon data-icon="inline-start" />
                    Создать курс
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col p-0">
                <ScrollArea className="min-h-0 flex-1">
                  <div className="flex flex-col">
                    {listLoading ? (
                      Array.from({ length: 7 }).map((_, index) => (
                        <div key={index} className="border-b px-4 py-3">
                          <Skeleton className="h-14 w-full" />
                        </div>
                      ))
                    ) : projects.length ? (
                      <div className="space-y-3 p-3">
                        {projects.map((project) => {
                          const statusForBadge = displayProjectStatus(project)
                          const isSelected = project.id === selectedId
                          return (
                            <div
                              key={project.id}
                              role="button"
                              tabIndex={0}
                              aria-pressed={isSelected}
                              aria-label={`Открыть курс ${project.name}`}
                              className={cn(
                                "w-full cursor-pointer rounded-2xl border p-2.5 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                                isSelected
                                  ? "border-primary/30 bg-muted/30 shadow-sm"
                                  : "border-border/70 bg-card/95"
                              )}
                              onClick={() => {
                                handleSelectProject(project.id)
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault()
                                  handleSelectProject(project.id)
                                }
                              }}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-base font-semibold">
                                    {project.name}
                                  </div>
                                </div>
                                <DropdownMenu>
                                  <DropdownMenuTrigger
                                    disabled={mutating}
                                    className={cn(
                                      buttonVariants({ variant: "ghost", size: "icon-sm" }),
                                      "shrink-0"
                                    )}
                                    onClick={(event) => event.stopPropagation()}
                                    onMouseDown={(event) => event.stopPropagation()}
                                  >
                                    <span className="sr-only">Действия курса</span>
                                    <MoreHorizontalIcon className="size-4" />
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="min-w-72 max-w-72">
                                    <DropdownMenuItem
                                      onClick={() => {
                                        if (handleSelectProject(project.id)) {
                                          setEditOpen(true)
                                        }
                                      }}
                                      className="items-start gap-3 py-2"
                                    >
                                      <PencilIcon className="mt-0.5 size-4" />
                                      <div className="space-y-0.5">
                                        <div className="whitespace-nowrap font-medium">
                                          Редактировать
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                          Открыть настройки и файлы выбранного курса.
                                        </div>
                                      </div>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => void handleGenerateAllForProject(project.id)}
                                      className="items-start gap-3 py-2"
                                    >
                                      {generatingStage === "source_compiled" && mutating ? (
                                        <Loader2Icon className="mt-0.5 size-4 animate-spin" />
                                      ) : (
                                        <WandSparklesIcon className="mt-0.5 size-4" />
                                      )}
                                      <div className="space-y-0.5">
                                        <div className="whitespace-nowrap font-medium">
                                          Автогенерация
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                          Последовательно запустить источник, план, материалы и тест.
                                        </div>
                                      </div>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() =>
                                        void handleOpenStructuredSource(project.id, project.name)
                                      }
                                      className="items-start gap-3 py-2"
                                    >
                                      <FileTextIcon className="mt-0.5 size-4" />
                                      <div className="space-y-0.5">
                                        <div className="whitespace-nowrap font-medium">
                                          Показать источник
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                          Открыть исходный текст после анализа и распознавания.
                                        </div>
                                      </div>
                                    </DropdownMenuItem>
                                    {canManage ? (
                                      <DropdownMenuItem
                                        variant="destructive"
                                        onClick={() => void handleDeleteProject(project)}
                                        className="items-start gap-3 py-2"
                                      >
                                        <Trash2Icon className="mt-0.5 size-4" />
                                        <div className="space-y-0.5">
                                          <div className="whitespace-nowrap font-medium">Удалить</div>
                                          <div className="text-xs text-muted-foreground">
                                            Полностью удалить курс и связанные данные.
                                          </div>
                                        </div>
                                      </DropdownMenuItem>
                                    ) : null}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                              <div className="mt-2 flex items-center justify-end gap-2">
                                <Badge variant={projectStatusBadgeVariant(statusForBadge)}>
                                  {projectStatusLabels[statusForBadge]}
                                </Badge>
                              </div>
                              <div className="mt-0.5 text-xs text-muted-foreground">
                                {formatDateLabel(project.updatedAt)}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                        Курсов пока нет. Создайте первый курс, чтобы начать работу.
                      </div>
                    )}
                  </div>
                </ScrollArea>
                <Separator />
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="text-sm text-muted-foreground">
                    Показаны {projectTotal === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}-
                    {Math.min(page * PAGE_SIZE, projectTotal)} из {projectTotal}
                  </div>
                  <Pagination className="mx-0 w-auto justify-end">
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          href="#"
                          onClick={(event) => {
                            event.preventDefault()
                            const nextPage = Math.max(1, page - 1)
                            setPage(nextPage)
                            void refreshProjects(nextPage)
                          }}
                        />
                      </PaginationItem>
                      {Array.from({ length: totalPages }, (_, index) => index + 1).map(
                        (pageNumber) => (
                          <PaginationItem key={pageNumber}>
                            <PaginationLink
                              href="#"
                              isActive={pageNumber === page}
                              onClick={(event) => {
                                event.preventDefault()
                                setPage(pageNumber)
                                void refreshProjects(pageNumber)
                              }}
                            >
                              {pageNumber}
                            </PaginationLink>
                          </PaginationItem>
                        )
                      )}
                      <PaginationItem>
                        <PaginationNext
                          href="#"
                          onClick={(event) => {
                            event.preventDefault()
                            const nextPage = Math.min(totalPages, page + 1)
                            setPage(nextPage)
                            void refreshProjects(nextPage)
                          }}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              </CardContent>
            </Card>

            <Card className="flex h-full min-h-[720px] flex-col overflow-hidden border-border/70 bg-card/95 shadow-sm">
              {!selectedProject && !detailLoading ? (
                <CardContent className="flex h-full min-h-[640px] items-center justify-center">
                  <div className="max-w-md space-y-2 text-center">
                    <h2 className="font-heading text-xl font-semibold">Выберите курс</h2>
                    <p className="text-sm text-muted-foreground">
                      Слева доступен список курсов. После выбора откроются материалы курса.
                    </p>
                  </div>
                </CardContent>
              ) : detailLoading && !selectedProject ? (
                <CardContent className="space-y-4 p-4">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-[520px] w-full" />
                </CardContent>
              ) : selectedProject ? (
                <>
                  <CardHeader className="border-b border-border/70 bg-muted/20">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-col gap-2">
                        <CardTitle className="truncate text-2xl">
                          {selectedProject.name}
                        </CardTitle>
                      </div>
                      <div />
                    </div>
                  </CardHeader>

                  {detailError ? (
                    <div className="border-b p-4">
                      <Alert>
                        <AlertCircleIcon />
                        <AlertTitle>Не удалось загрузить курс</AlertTitle>
                        <AlertDescription>{detailError}</AlertDescription>
                      </Alert>
                    </div>
                  ) : null}

                  <CardContent className="flex-1 space-y-4 p-4">
                    <Card className="flex h-full min-h-[620px] flex-col">
                      <CardHeader className="space-y-4">
                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                          {VISIBLE_STAGES.map((stage) => {
                            const stageStatus =
                              selectedProject.stages.find((item) => item.id === stage)?.status ??
                              "queued"

                            return (
                              <button
                                key={stage}
                                type="button"
                                className={cn(
                                  "w-full rounded-2xl border p-3 text-left transition-colors hover:bg-muted/35",
                                  selectedStage === stage
                                    ? "border-primary/30 bg-muted/30 shadow-sm"
                                    : "border-border/70 bg-card/95"
                                )}
                                onClick={() => {
                                  handleSelectStage(stage)
                                }}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="space-y-1">
                                    <div className="text-sm font-medium">{stageLabels[stage]}</div>
                                  </div>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger
                                      disabled={mutating}
                                      className={cn(
                                        buttonVariants({ variant: "ghost", size: "icon-xs" }),
                                        "shrink-0"
                                      )}
                                      onClick={(event) => event.stopPropagation()}
                                      onMouseDown={(event) => event.stopPropagation()}
                                    >
                                      <span className="sr-only">
                                        Действия раздела {stageLabels[stage]}
                                      </span>
                                      <MoreHorizontalIcon className="size-3.5" />
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="min-w-72 max-w-72">
                                      <DropdownMenuItem
                                        disabled={isGenerateDisabled(stage)}
                                        onClick={() => void handleGenerate(stage)}
                                        className="items-start gap-3 py-2"
                                      >
                                        {generatingStage === stage && mutating ? (
                                          <Loader2Icon className="mt-0.5 size-4 animate-spin" />
                                        ) : (
                                          <WandSparklesIcon className="mt-0.5 size-4" />
                                        )}
                                        <div className="space-y-0.5">
                                          <div className="whitespace-nowrap font-medium">
                                            {generationLabelByStage[stage]}
                                          </div>
                                          <div className="text-xs text-muted-foreground">
                                            Запустить генерацию только для этого этапа.
                                          </div>
                                        </div>
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => {
                                          if (!handleSelectStage(stage)) {
                                            return
                                          }
                                          setIsEditing((current) =>
                                            selectedStage === stage ? !current : true
                                          )
                                        }}
                                        className="items-start gap-3 py-2"
                                      >
                                        <PencilIcon className="mt-0.5 size-4" />
                                        <div className="space-y-0.5">
                                          <div className="whitespace-nowrap font-medium">
                                            {selectedStage === stage && isEditing
                                              ? "Просмотр"
                                              : "Редактировать"}
                                          </div>
                                          <div className="text-xs text-muted-foreground">
                                            Переключить режим редактирования текста этапа.
                                          </div>
                                        </div>
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        disabled={
                                          mutating ||
                                          stage !== selectedStage ||
                                          !currentStageArtifact ||
                                          !hasUnsavedChanges
                                        }
                                        onClick={() => {
                                          if (!handleSelectStage(stage)) {
                                            return
                                          }
                                          setIsEditing(false)
                                          void handleSaveDraft()
                                        }}
                                        className="items-start gap-3 py-2"
                                      >
                                        <SaveIcon className="mt-0.5 size-4" />
                                        <div className="space-y-0.5">
                                          <div className="whitespace-nowrap font-medium">
                                            Сохранить
                                          </div>
                                          <div className="text-xs text-muted-foreground">
                                            Сохранить изменения текущего этапа в базе.
                                          </div>
                                        </div>
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                                <div className="mt-3 flex items-center justify-between gap-2">
                                  <Badge
                                    variant={
                                      stageStatus === "done"
                                        ? "default"
                                        : stageStatus === "processing"
                                          ? "secondary"
                                          : "outline"
                                    }
                                  >
                                    {stageStatus === "done"
                                      ? "Готов"
                                      : stageStatus === "processing"
                                        ? "В обработке"
                                        : "Ожидает"}
                                  </Badge>
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      </CardHeader>
                      <CardContent className="flex-1 space-y-4">
                        {isEditing ? (
                          <Textarea
                            value={editorValue}
                            onChange={(event) => setEditorValue(event.target.value)}
                            className="h-[620px] resize-none overflow-y-auto font-mono text-sm"
                          />
                        ) : editorValue.trim() ? (
                          <div className="h-[620px] overflow-y-auto border border-border bg-muted/20 p-4">
                            <MarkdownContent value={editorValue} />
                          </div>
                        ) : (
                          <div className="flex min-h-[620px] items-center justify-center border border-dashed border-border/70 bg-muted/10 p-8 text-center">
                            <div className="max-w-md space-y-4">
                              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-secondary">
                                <WandSparklesIcon className="size-5 text-muted-foreground" />
                              </div>
                              <div className="space-y-1.5">
                                <h3 className="text-base font-semibold">Результат пока не создан</h3>
                                {selectedStageIsProcessing ? null : (
                                  <p className="text-sm text-muted-foreground">
                                    Запустите генерацию для этапа «{stageLabels[selectedStage]}», чтобы
                                    увидеть текст в этом окне.
                                  </p>
                                )}
                              </div>
                              <div className="space-y-1.5">
                                {selectedStageIsProcessing ? (
                                  <div className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                                    <Loader2Icon className="size-4 animate-spin" />
                                    Идёт генерация...
                                  </div>
                                ) : (
                                  <Button
                                    variant="outline"
                                    onClick={() => void handleGenerate(selectedStage)}
                                    disabled={isGenerateDisabled(selectedStage)}
                                  >
                                    <WandSparklesIcon data-icon="inline-start" />
                                    {generationLabelByStage[selectedStage]}
                                  </Button>
                                )}
                                {isGenerateDisabled(selectedStage) ? (
                                  <p className="text-xs text-muted-foreground">
                                    {getGenerateBlockedReason(selectedStage)}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </CardContent>
                </>
              ) : null}
            </Card>
          </section>
        </div>
      </div>

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent className="w-full gap-0 sm:max-w-[760px]">
          <SheetHeader className="border-b">
            <SheetTitle>Создать курс</SheetTitle>
            <SheetDescription>
              Укажите название, добавьте контекст и загрузите исходные файлы.
            </SheetDescription>
          </SheetHeader>
          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-6 p-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="course-name">Название курса</Label>
                <Input
                  id="course-name"
                  value={courseName}
                  onChange={(event) => setCourseName(event.target.value)}
                  placeholder="Например: Продажа и монтаж изделий"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="course-note">Комментарий</Label>
                <Textarea
                  id="course-note"
                  value={courseNote}
                  onChange={(event) => setCourseNote(event.target.value)}
                  className="min-h-28"
                  placeholder="Контекст для генерации материалов."
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="course-files">Файлы курса</Label>
                <div
                  className={cn(
                    "border border-dashed p-4 transition-colors",
                    createDropActive
                      ? "border-primary bg-secondary/70"
                      : "border-border bg-background"
                  )}
                  onDragEnter={(event) => {
                    event.preventDefault()
                    setCreateDropActive(true)
                  }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setCreateDropActive(true)
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault()
                    setCreateDropActive(false)
                  }}
                  onDrop={handleCreateFilesDrop}
                >
                  <div className="flex flex-col items-center gap-2 py-4 text-center">
                    <div className="bg-secondary p-3">
                      <UploadIcon className="size-5 text-primary" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium">
                        Перетащите файлы сюда или выберите вручную
                      </p>
                      <p className="text-xs text-muted-foreground">
                        До {MAX_CREATE_FILES} файлов: PDF, PPT/PPTX, DOC/DOCX, TXT/MD/RTF, аудио и видео
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => createFilesInputRef.current?.click()}
                    >
                      Выбрать файлы
                    </Button>
                  </div>
                </div>
                <Input
                  ref={createFilesInputRef}
                  id="course-files"
                  type="file"
                  multiple
                  accept={CREATE_FILES_ACCEPT}
                  className="sr-only"
                  onChange={(event) => {
                    selectCreateFiles(Array.from(event.target.files ?? []))
                    event.currentTarget.value = ""
                  }}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {createFiles.length ? (
                  createFiles.map((file) => (
                    <Badge
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                      variant="secondary"
                      className="gap-1.5 pr-1"
                    >
                      <span className="max-w-[320px] truncate">{file.name}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="h-4 w-4 hover:bg-background/60"
                        onClick={() => removeCreateFile(file)}
                        aria-label={`Удалить файл ${file.name}`}
                      >
                        <XIcon className="size-3" />
                      </Button>
                    </Badge>
                  ))
                ) : (
                  <Badge variant="outline">Файлы не выбраны</Badge>
                )}
              </div>

              {createFilesError ? (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertTitle>Проверьте файлы</AlertTitle>
                  <AlertDescription>{createFilesError}</AlertDescription>
                </Alert>
              ) : null}

              {createUploadVisible ? (
                <div className="flex flex-col gap-2">
                  <Progress value={uploadProgress} className="flex-col gap-2">
                    <ProgressLabel>Загрузка файлов</ProgressLabel>
                    <ProgressValue>
                      {(formattedValue, value) => `${formattedValue ?? value ?? 0}%`}
                    </ProgressValue>
                  </Progress>
                  <div className="text-xs text-muted-foreground">{uploadMessage}</div>
                </div>
              ) : null}
            </div>
          </ScrollArea>
          <SheetFooter className="border-t">
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={mutating || uploadPhase === "uploading"}
            >
              Отмена
            </Button>
            <Button
              onClick={() => void handleCreateCourse()}
              disabled={!courseName.trim() || mutating || uploadPhase === "uploading"}
            >
              {mutating ? (
                <Loader2Icon data-icon="inline-start" className="animate-spin" />
              ) : (
                <PlusIcon data-icon="inline-start" />
              )}
              {mutating ? "Создаём курс..." : "Создать курс"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent className="w-full gap-0 sm:max-w-[760px]">
          <SheetHeader className="border-b">
            <SheetTitle>Редактировать курс</SheetTitle>
            <SheetDescription>
              Управление контекстом и исходными файлами курса.
            </SheetDescription>
          </SheetHeader>
          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-5 p-4">
              <Card>
                <CardHeader>
                  <CardTitle>Контекст генерации</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Textarea
                    value={regenerationContext}
                    onChange={(event) => setRegenerationContext(event.target.value)}
                    className="min-h-28"
                    placeholder="Контекст для следующих запусков генерации."
                  />
                  <Button
                    variant="outline"
                    onClick={() => void handleSaveContext()}
                    disabled={!selectedProject || mutating}
                  >
                    Сохранить контекст
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Добавить файлы</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input
                    id="detail-files"
                    type="file"
                    multiple
                    onChange={(event) => setDetailFiles(Array.from(event.target.files ?? []))}
                  />
                  <div className="flex flex-wrap gap-2">
                    {detailFiles.length ? (
                      detailFiles.map((file) => (
                        <Badge key={`${file.name}-${file.size}`} variant="secondary">
                          {file.name}
                        </Badge>
                      ))
                    ) : (
                      <Badge variant="outline">Файлы не выбраны</Badge>
                    )}
                  </div>
                  {detailUploadVisible ? (
                    <div className="space-y-2">
                      <Progress value={uploadProgress} className="flex-col gap-2">
                        <ProgressLabel>Загрузка файлов</ProgressLabel>
                        <ProgressValue>
                          {(formattedValue, value) => `${formattedValue ?? value ?? 0}%`}
                        </ProgressValue>
                      </Progress>
                      <div className="text-xs text-muted-foreground">{uploadMessage}</div>
                    </div>
                  ) : null}
                  <Button
                    variant="outline"
                    onClick={() => void handleUploadFiles()}
                    disabled={!detailFiles.length || uploadPhase === "uploading"}
                  >
                    <UploadIcon data-icon="inline-start" />
                    {uploadPhase === "uploading" && uploadContext === "detail"
                      ? "Загрузка..."
                      : "Загрузить файлы"}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Исходные файлы курса</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Файл</TableHead>
                        <TableHead>Тип</TableHead>
                        <TableHead>Статус</TableHead>
                        <TableHead className="text-right">Размер</TableHead>
                        <TableHead className="w-[1%]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedProject?.sourceFiles.length ? (
                        selectedProject.sourceFiles.map((file) => (
                          <TableRow key={file.id}>
                            <TableCell className="max-w-[280px] truncate font-medium">
                              {file.originalName}
                            </TableCell>
                            <TableCell className="capitalize">{file.kind}</TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {sourceFileStatusLabel(file.uploadStatus)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              {(file.sizeBytes / 1024 / 1024).toFixed(1)} МБ
                            </TableCell>
                            <TableCell>
                              {canManage ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void handleDeleteSourceFile(file.id)}
                                  disabled={mutating}
                                >
                                  Удалить
                                </Button>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={5}>
                            <div className="py-8 text-center text-sm text-muted-foreground">
                              Для курса пока не загружено ни одного файла.
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </ScrollArea>
          <SheetFooter className="border-t">
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Закрыть
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={sourcePreviewOpen} onOpenChange={setSourcePreviewOpen}>
        <SheetContent className="flex h-full w-full flex-col gap-0 sm:max-w-[980px]">
          <SheetHeader className="border-b">
            <SheetTitle>Источник</SheetTitle>
            <SheetDescription>
              Курс: {sourcePreviewProjectName || "Без названия"}
            </SheetDescription>
          </SheetHeader>
          <ScrollArea className="min-h-0 flex-1">
            <div className="p-4">
              {sourcePreviewLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-5 w-2/5" />
                  <Skeleton className="h-[520px] w-full" />
                </div>
              ) : sourcePreviewError ? (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertTitle>Не удалось открыть источник</AlertTitle>
                  <AlertDescription>{sourcePreviewError}</AlertDescription>
                </Alert>
              ) : sourcePreviewContent.trim() ? (
                <div className="min-h-[620px] border border-border bg-muted/20 p-4">
                  <MarkdownContent value={sourcePreviewContent} />
                </div>
              ) : (
                <div className="flex min-h-[620px] items-center justify-center border border-dashed border-border/70 bg-muted/10 p-8 text-center text-sm text-muted-foreground">
                  Для этого курса пока нет сохранённого структурированного источника.
                </div>
              )}
            </div>
          </ScrollArea>
          <SheetFooter className="border-t">
            <Button variant="outline" onClick={() => setSourcePreviewOpen(false)}>
              Закрыть
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(92vw,420px)] flex-col items-end gap-2">
        {alerts.map((item) => (
          <Alert
            key={item.id}
            variant={item.type === "error" ? "destructive" : "default"}
            className={cn(
              "pointer-events-auto relative w-full pr-10 shadow-lg",
              item.type === "success" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : ""
            )}
          >
            <AlertTitle>{item.title}</AlertTitle>
            {item.description ? <AlertDescription>{item.description}</AlertDescription> : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute right-2 top-2"
              onClick={() => dismissAlert(item.id)}
              aria-label="Закрыть уведомление"
            >
              <XIcon className="size-3.5" />
            </Button>
          </Alert>
        ))}
      </div>
    </>
  )
}
