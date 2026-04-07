"use client"

import { useEffect, useMemo, useState } from "react"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  FileDownIcon,
  FileTextIcon,
  Loader2Icon,
  PencilLineIcon,
  PlusIcon,
  PlayIcon,
  RefreshCwIcon,
  SaveIcon,
  SparklesIcon,
  UploadIcon,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

import {
  abortUpload,
  approveArtifact,
  completeUpload,
  createProject,
  downloadProject,
  getProject,
  initUpload,
  listProjects,
  projectStatusLabels,
  retryJob,
  signUploadPart,
  stageLabels,
  stageOrder,
  startProject,
  updateArtifact,
  type ProcessingJobRecord,
  type ProjectDetailRecord,
  type ProjectRecord,
  type ProjectStatus,
  type StageId,
} from "@/lib/ecolms-api"

const PAGE_SIZE = 25
const PART_SIZE_BYTES = 10 * 1024 * 1024

type UploadPhase = "idle" | "uploading" | "done" | "error"
type UploadContext = "create" | "detail" | null
type WorkspaceTab = "overview" | "stages" | "journal"

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
    case "awaiting_review":
      return "secondary"
    case "completed":
      return "default"
    case "failed":
      return "destructive"
  }
}

function stageStatusBadgeVariant(status: ProcessingJobRecord["status"]) {
  switch (status) {
    case "done":
      return "default" as const
    case "processing":
      return "secondary" as const
    case "failed":
      return "destructive" as const
    default:
      return "outline" as const
  }
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

function getStageArtifact(
  project: ProjectDetailRecord | null,
  stage: StageId,
  format: "md" | "json" = "md"
) {
  return project?.artifacts.find(
    (artifact) => artifact.stage === stage && artifact.format === format
  )
}

function getStageMarkdown(project: ProjectDetailRecord | null, stage: StageId) {
  return (
    getStageArtifact(project, stage, "md")?.contentMd ??
    project?.stageDrafts[stage] ??
    ""
  )
}

function latestJobs(jobs: ProcessingJobRecord[]) {
  return [...jobs].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
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

function stageBadgeLabel(status: ProcessingJobRecord["status"]) {
  switch (status) {
    case "done":
      return "Готов"
    case "processing":
      return "В работе"
    case "failed":
      return "Ошибка"
    default:
      return "Ожидает"
  }
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

function stageLabelForProject(project: ProjectRecord) {
  return stageLabels[project.currentStage]
}

function statusAccent(status: ProjectStatus) {
  switch (status) {
    case "awaiting_review":
      return "border-l-2 border-l-primary/60"
    case "failed":
      return "border-l-2 border-l-destructive/60"
    case "processing":
      return "border-l-2 border-l-secondary-foreground/30"
    default:
      return "border-l-2 border-l-transparent"
  }
}

export function EcolmsDashboard() {
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [projectTotal, setProjectTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedProject, setSelectedProject] =
    useState<ProjectDetailRecord | null>(null)
  const [selectedStage, setSelectedStage] = useState<StageId>("source_compiled")
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("overview")
  const [editorValue, setEditorValue] = useState("")
  const [isEditing, setIsEditing] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [courseName, setCourseName] = useState("")
  const [courseNote, setCourseNote] = useState("")
  const [createFiles, setCreateFiles] = useState<File[]>([])
  const [detailFiles, setDetailFiles] = useState<File[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [mutating, setMutating] = useState(false)
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle")
  const [uploadContext, setUploadContext] = useState<UploadContext>(null)
  const [uploadMessage, setUploadMessage] = useState("")
  const [uploadProgress, setUploadProgress] = useState(0)
  const [listError, setListError] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [jobErrorOpen, setJobErrorOpen] = useState(false)
  const [selectedJobError, setSelectedJobError] = useState("")

  const totalPages = Math.max(1, Math.ceil(projectTotal / PAGE_SIZE))
  const currentStageArtifact = getStageArtifact(
    selectedProject,
    selectedStage,
    "md"
  )
  const jobs = useMemo(
    () => latestJobs(selectedProject?.jobs ?? []),
    [selectedProject]
  )

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
        return
      }

      if (!selectedId || !response.items.some((project) => project.id === selectedId)) {
        setSelectedId(response.items[0]?.id ?? null)
      }
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Не удалось загрузить курсы")
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
      setSelectedStage(response.currentStage)
      setEditorValue(getStageMarkdown(response, response.currentStage))
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
    if (!selectedId) {
      return
    }

    void refreshProject(selectedId)
  }, [selectedId])

  useEffect(() => {
    if (!selectedProject) {
      return
    }

    setSelectedStage(selectedProject.currentStage)
    setEditorValue(getStageMarkdown(selectedProject, selectedProject.currentStage))
    setIsEditing(false)
  }, [selectedProject])

  useEffect(() => {
    if (!selectedProject) {
      return
    }

    setEditorValue(getStageMarkdown(selectedProject, selectedStage))
  }, [selectedProject, selectedStage])

  function resetUploadState() {
    setUploadPhase("idle")
    setUploadContext(null)
    setUploadMessage("")
    setUploadProgress(0)
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
        let uploadAborted = false

        try {
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

            completedChunks += 1
            setUploadProgress(Math.round((completedChunks / totalChunks) * 100))
          }

          await completeUpload(init.uploadId)
        } catch (error) {
          uploadAborted = true
          await abortUpload(init.uploadId).catch(() => undefined)
          throw error
        } finally {
          if (uploadAborted) {
            setUploadMessage(`Загрузка ${file.name} прервана`)
          }
        }
      }

      setUploadPhase("done")
      setUploadMessage("Файлы загружены")
      await refreshProjects(nextPage)
      await refreshProject(projectId)
    } catch (error) {
      setUploadPhase("error")
      setUploadMessage(
        error instanceof Error ? error.message : "Не удалось загрузить файлы"
      )
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
      setSelectedStage(created.currentStage)
      setEditorValue(getStageMarkdown(created, created.currentStage))
      setPage(1)
      setActiveTab("overview")

      if (createFiles.length > 0) {
        await uploadFilesForProject(created.id, createFiles, "create", 1)
      } else {
        await refreshProjects(1)
        await refreshProject(created.id)
      }

      setCourseName("")
      setCourseNote("")
      setCreateFiles([])
      setDetailFiles([])
      setCreateOpen(false)
      resetUploadState()
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Не удалось создать курс")
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

  async function handleStartProject() {
    if (!selectedProject) {
      return
    }

    setMutating(true)
    try {
      await startProject(selectedProject.id)
      await refreshProjects(page)
      await refreshProject(selectedProject.id)
    } finally {
      setMutating(false)
    }
  }

  async function handleSaveDraft() {
    if (!selectedProject || !currentStageArtifact) {
      return
    }

    setMutating(true)
    try {
      await updateArtifact(selectedProject.id, currentStageArtifact.id, editorValue)
      await refreshProjects(page)
      await refreshProject(selectedProject.id)
    } finally {
      setMutating(false)
    }
  }

  async function handleApproveStage() {
    if (!selectedProject || !currentStageArtifact) {
      return
    }

    setMutating(true)
    try {
      const response = await approveArtifact(selectedProject.id, currentStageArtifact.id)
      setSelectedProject(response.project)
      setSelectedId(response.project.id)
      setSelectedStage(response.project.currentStage)
      setEditorValue(getStageMarkdown(response.project, response.project.currentStage))
      await refreshProjects(page)
    } finally {
      setMutating(false)
    }
  }

  async function handleRetryJob(jobId: string) {
    if (!selectedProject) {
      return
    }

    setMutating(true)
    try {
      await retryJob(selectedProject.id, jobId)
      await refreshProject(selectedProject.id)
      await refreshProjects(page)
    } finally {
      setMutating(false)
    }
  }

  async function handleDownloadArtifact(stage: StageId, format: "md" | "json") {
    if (!selectedProject) {
      return
    }

    const assets = await downloadProject(selectedProject.id)
    const asset = assets.find(
      (item) => item.stage === stage && item.format === format
    )
    if (asset) {
      window.open(asset.downloadUrl, "_blank", "noopener,noreferrer")
    }
  }

  const summary = useMemo(() => {
    const awaiting = projects.filter(
      (project) => project.status === "awaiting_review"
    ).length
    const completed = projects.filter((project) => project.status === "completed").length
    const processing = projects.filter(
      (project) => project.status === "processing"
    ).length
    const withFiles = projects.filter((project) => project.sourceFiles.length > 0).length

    return {
      total: projectTotal,
      awaiting,
      processing,
      completed,
      withFiles,
    }
  }, [projectTotal, projects])

  const attentionProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          project.status === "awaiting_review" || project.status === "failed"
      ),
    [projects]
  )

  const createUploadVisible = uploadContext === "create" && uploadPhase !== "idle"
  const detailUploadVisible = uploadContext === "detail" && uploadPhase !== "idle"

  async function handlePrimaryAction() {
    if (!selectedProject) {
      return
    }

    switch (selectedProject.status) {
      case "draft": {
        setActiveTab("overview")
        break
      }
      case "uploaded": {
        await handleStartProject()
        break
      }
      case "processing": {
        await refreshProject(selectedProject.id)
        await refreshProjects(page)
        break
      }
      case "awaiting_review": {
        setSelectedStage(selectedProject.currentStage)
        setActiveTab("stages")
        break
      }
      case "completed": {
        await handleDownloadArtifact(selectedProject.currentStage, "md")
        break
      }
      case "failed": {
        setActiveTab("journal")
        break
      }
    }
  }

  const primaryActionLabel = (() => {
    if (!selectedProject) {
      return "Выберите курс"
    }

    switch (selectedProject.status) {
      case "draft":
        return "Добавить файлы"
      case "uploaded":
        return "Запустить обработку"
      case "processing":
        return "Обновить статус"
      case "awaiting_review":
        return "Открыть этап на проверку"
      case "completed":
        return "Скачать результат"
      case "failed":
        return "Перейти в журнал"
    }
  })()

  const primaryActionHint = (() => {
    if (!selectedProject) {
      return "Выберите курс в левой колонке, чтобы увидеть рабочие действия."
    }

    switch (selectedProject.status) {
      case "draft":
        return "После загрузки исходников курс будет готов к запуску обработки."
      case "uploaded":
        return "Система запустит генерацию этапов и создаст задания в очереди."
      case "processing":
        return "Обновите карточку, чтобы проверить текущий прогресс по этапам."
      case "awaiting_review":
        return "Проверьте текущий этап, внесите правки и подтвердите результат."
      case "completed":
        return "Итоговый артефакт доступен для выгрузки в формате Markdown."
      case "failed":
        return "Откройте журнал, чтобы посмотреть текст ошибки и перезапустить job."
    }
  })()

  return (
    <>
      <div className="min-h-screen bg-[linear-gradient(180deg,_rgba(237,243,236,0.88)_0%,_rgba(247,247,241,0.9)_45%,_rgba(248,247,242,1)_100%)]">
        <div className="mx-auto flex min-h-screen w-full max-w-[1760px] flex-col gap-5 px-6 py-6">
          <header className="flex items-end justify-between gap-4 rounded-4xl border border-border/80 bg-card px-6 py-5 shadow-[0_10px_24px_rgba(20,55,28,0.08)]">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                <SparklesIcon className="size-4" />
                Конструктор обучающих курсов
              </div>
              <h1 className="font-heading text-3xl font-semibold tracking-tight">
                Рабочее пространство EcoLMS
              </h1>
              <p className="text-sm text-muted-foreground">
                Операционный экран для запуска, проверки и выпуска материалов курса.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 rounded-full bg-secondary/70 px-4 py-2">
                <span className="size-2 rounded-full bg-primary" />
                <span className="font-heading text-sm font-bold tracking-[0.06em] text-foreground">
                  ECOOKNA GROUP
                </span>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  void refreshProjects(page)
                  if (selectedProject?.id) {
                    void refreshProject(selectedProject.id)
                  }
                }}
                disabled={listLoading}
              >
                <RefreshCwIcon data-icon="inline-start" />
                Обновить
              </Button>
              <Button onClick={() => setCreateOpen(true)}>
                <PlusIcon data-icon="inline-start" />
                Создать курс
              </Button>
            </div>
          </header>

          <section className="grid grid-cols-4 gap-3">
            <Card size="sm" className="border-border/80 bg-secondary/35">
              <CardHeader>
                <CardDescription>Всего курсов</CardDescription>
                <CardTitle className="text-3xl">{summary.total}</CardTitle>
              </CardHeader>
            </Card>
            <Card size="sm" className="border-border/80 bg-secondary/35">
              <CardHeader>
                <CardDescription>Требуют внимания</CardDescription>
                <CardTitle className="text-3xl">{summary.awaiting}</CardTitle>
              </CardHeader>
            </Card>
            <Card size="sm" className="border-border/80 bg-secondary/35">
              <CardHeader>
                <CardDescription>В обработке</CardDescription>
                <CardTitle className="text-3xl">{summary.processing}</CardTitle>
              </CardHeader>
            </Card>
            <Card size="sm" className="border-border/80 bg-secondary/35">
              <CardHeader>
                <CardDescription>Готово</CardDescription>
                <CardTitle className="text-3xl">{summary.completed}</CardTitle>
              </CardHeader>
            </Card>
          </section>

          {listError ? (
            <Alert>
              <AlertCircleIcon />
              <AlertTitle>Ошибка операции</AlertTitle>
              <AlertDescription>{listError}</AlertDescription>
            </Alert>
          ) : null}

          <section className="grid flex-1 grid-cols-[420px_minmax(0,1fr)] gap-4">
            <Card className="overflow-hidden rounded-4xl border-border/80 bg-card shadow-[0_10px_26px_rgba(20,55,28,0.06)]">
              <CardHeader className="border-b bg-secondary/35">
                <CardTitle>Курсы</CardTitle>
                <CardDescription>
                  Список курсов и их текущий этап обработки.
                </CardDescription>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Badge variant="outline">С файлами: {summary.withFiles}</Badge>
                  <Badge variant={attentionProjects.length ? "secondary" : "outline"}>
                    На контроле: {attentionProjects.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[calc(100vh-380px)]">
                  <div className="flex flex-col">
                    {listLoading ? (
                      Array.from({ length: 7 }).map((_, index) => (
                        <div key={index} className="border-b px-4 py-3">
                          <Skeleton className="h-14 w-full" />
                        </div>
                      ))
                    ) : projects.length ? (
                      projects.map((project) => (
                        <Button
                          key={project.id}
                          variant="ghost"
                          className={cn(
                            "h-auto w-full justify-start rounded-none border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-secondary/35",
                            statusAccent(project.status),
                            project.id === selectedProject?.id && "bg-muted"
                          )}
                          onClick={() => {
                            setSelectedId(project.id)
                            setActiveTab("overview")
                          }}
                        >
                          <div className="flex w-full flex-col gap-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex min-w-0 flex-col gap-1">
                                <span className="truncate font-medium">{project.name}</span>
                                <span className="line-clamp-2 text-xs text-muted-foreground">
                                  {project.sourceSummary || "Описание появится после обработки."}
                                </span>
                              </div>
                              <Badge variant={projectStatusBadgeVariant(project.status)}>
                                {projectStatusLabels[project.status]}
                              </Badge>
                            </div>
                            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                              <span>{stageLabelForProject(project)}</span>
                              <span>{formatDateLabel(project.updatedAt)}</span>
                            </div>
                          </div>
                        </Button>
                      ))
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

            <Card className="overflow-hidden rounded-4xl border-border/80 bg-card shadow-[0_10px_26px_rgba(20,55,28,0.06)]">
              {!selectedProject && !detailLoading ? (
                <CardContent className="flex h-full min-h-[600px] items-center justify-center">
                  <div className="max-w-md space-y-2 text-center">
                    <h2 className="font-heading text-xl font-semibold">Выберите курс</h2>
                    <p className="text-sm text-muted-foreground">
                      Слева доступен список курсов. После выбора откроются этапы,
                      загрузки и журнал заданий.
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
                  <CardHeader className="border-b bg-secondary/20">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-col gap-2">
                        <CardTitle className="truncate text-2xl">
                          {selectedProject.name}
                        </CardTitle>
                        <CardDescription>
                          {selectedProject.overview ||
                            "Курс готов к загрузке исходников и последовательной сборке материалов."}
                        </CardDescription>
                      </div>
                      <Badge variant={projectStatusBadgeVariant(selectedProject.status)}>
                        {projectStatusLabels[selectedProject.status]}
                      </Badge>
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

                  <CardContent className="space-y-4 p-4">
                    <Card size="sm" className="border-border/80 bg-secondary/28">
                      <CardHeader>
                        <CardTitle className="text-base">Путь по этапам</CardTitle>
                        <CardDescription>
                          Текущий этап: {stageLabels[selectedProject.currentStage]}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="grid grid-cols-4 gap-2">
                        {stageOrder.map((stage) => {
                          const stageState = selectedProject.stages.find(
                            (item) => item.id === stage
                          )
                          return (
                            <div
                              key={stage}
                              className={cn(
                                "rounded-lg border px-3 py-2",
                                selectedProject.currentStage === stage && "border-primary/60"
                              )}
                            >
                              <div className="text-xs font-medium">{stageLabels[stage]}</div>
                              <div className="mt-1 flex items-center gap-2">
                                <Badge
                                  variant={stageStatusBadgeVariant(
                                    stageState?.status ?? "queued"
                                  )}
                                >
                                  {stageBadgeLabel(stageState?.status ?? "queued")}
                                </Badge>
                              </div>
                            </div>
                          )
                        })}
                      </CardContent>
                    </Card>

                    <Card size="sm" className="border-border/80 bg-secondary/28">
                      <CardHeader>
                        <CardTitle className="text-base">Главное действие</CardTitle>
                        <CardDescription>{primaryActionHint}</CardDescription>
                      </CardHeader>
                      <CardContent className="flex items-center justify-between gap-3">
                        <Button
                          onClick={() => void handlePrimaryAction()}
                          disabled={!selectedProject || mutating}
                        >
                          {selectedProject?.status === "uploaded" ? (
                            <PlayIcon data-icon="inline-start" />
                          ) : selectedProject?.status === "processing" ? (
                            <RefreshCwIcon data-icon="inline-start" />
                          ) : selectedProject?.status === "completed" ? (
                            <FileDownIcon data-icon="inline-start" />
                          ) : (
                            <CheckCircle2Icon data-icon="inline-start" />
                          )}
                          {primaryActionLabel}
                        </Button>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            onClick={() => {
                              void refreshProjects(page)
                              void refreshProject(selectedProject.id)
                            }}
                            disabled={detailLoading || mutating}
                          >
                            <RefreshCwIcon data-icon="inline-start" />
                            Обновить курс
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() =>
                              void handleDownloadArtifact(selectedProject.currentStage, "md")
                            }
                            disabled={!currentStageArtifact}
                          >
                            <FileTextIcon data-icon="inline-start" />
                            Скачать текущий этап
                          </Button>
                        </div>
                      </CardContent>
                    </Card>

                    <Tabs
                      value={activeTab}
                      onValueChange={(value) => setActiveTab(value as WorkspaceTab)}
                      className="gap-0"
                    >
                      <TabsList variant="line" className="border-b bg-secondary/20 px-1">
                        <TabsTrigger value="overview">Обзор</TabsTrigger>
                        <TabsTrigger value="stages">Этапы</TabsTrigger>
                        <TabsTrigger value="journal">Журнал</TabsTrigger>
                      </TabsList>

                      <TabsContent value="overview" className="pt-4">
                        <div className="grid grid-cols-3 gap-3">
                          <Card size="sm">
                            <CardHeader>
                              <CardDescription>Файлов в курсе</CardDescription>
                              <CardTitle>{selectedProject.sourceFiles.length}</CardTitle>
                            </CardHeader>
                          </Card>
                          <Card size="sm">
                            <CardHeader>
                              <CardDescription>Подтверждено этапов</CardDescription>
                              <CardTitle>{selectedProject.reviews.length}</CardTitle>
                            </CardHeader>
                          </Card>
                          <Card size="sm">
                            <CardHeader>
                              <CardDescription>Последнее обновление</CardDescription>
                              <CardTitle className="text-base">
                                {formatDateLabel(selectedProject.updatedAt)}
                              </CardTitle>
                            </CardHeader>
                          </Card>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-4">
                          <Card>
                            <CardHeader>
                              <CardTitle>Загрузка файлов</CardTitle>
                              <CardDescription>
                                Добавьте новые материалы, затем запустите обработку.
                              </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              <div className="space-y-2">
                                <Label htmlFor="detail-files">Новые файлы</Label>
                                <Input
                                  id="detail-files"
                                  type="file"
                                  multiple
                                  onChange={(event) =>
                                    setDetailFiles(Array.from(event.target.files ?? []))
                                  }
                                />
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {detailFiles.length ? (
                                  detailFiles.map((file) => (
                                    <Badge
                                      key={`${file.name}-${file.size}`}
                                      variant="secondary"
                                    >
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
                                      {(formattedValue, value) =>
                                        `${formattedValue ?? value ?? 0}%`
                                      }
                                    </ProgressValue>
                                  </Progress>
                                  <div className="text-xs text-muted-foreground">
                                    {uploadMessage}
                                  </div>
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
                              <CardTitle>Исходные файлы</CardTitle>
                              <CardDescription>
                                Материалы, уже привязанные к текущему курсу.
                              </CardDescription>
                            </CardHeader>
                            <CardContent className="p-0">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Файл</TableHead>
                                    <TableHead>Тип</TableHead>
                                    <TableHead>Статус</TableHead>
                                    <TableHead className="text-right">Размер</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {selectedProject.sourceFiles.length ? (
                                    selectedProject.sourceFiles.map((file) => (
                                      <TableRow key={file.id}>
                                        <TableCell className="max-w-[240px] truncate font-medium">
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
                                      </TableRow>
                                    ))
                                  ) : (
                                    <TableRow>
                                      <TableCell colSpan={4}>
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
                      </TabsContent>

                      <TabsContent value="stages" className="pt-4">
                        <div className="grid grid-cols-[320px_minmax(0,1fr)] gap-4">
                          <Card>
                            <CardHeader>
                              <CardTitle>Этапы</CardTitle>
                              <CardDescription>
                                Выберите этап и проверьте результат перед подтверждением.
                              </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-2">
                              {selectedProject.stages.map((stage) => (
                                <Button
                                  key={stage.id}
                                  type="button"
                                  variant={selectedStage === stage.id ? "secondary" : "outline"}
                                  className="h-auto w-full justify-between px-3 py-3 text-left"
                                  onClick={() => {
                                    setSelectedStage(stage.id)
                                    setIsEditing(false)
                                  }}
                                >
                                  <div className="flex min-w-0 flex-col gap-1">
                                    <span className="font-medium">{stageLabels[stage.id]}</span>
                                    <span className="line-clamp-2 text-xs text-muted-foreground">
                                      {stage.note}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {formatDateLabel(stage.updatedAt)}
                                    </span>
                                  </div>
                                  <Badge variant={stageStatusBadgeVariant(stage.status)}>
                                    {stageBadgeLabel(stage.status)}
                                  </Badge>
                                </Button>
                              ))}
                            </CardContent>
                          </Card>

                          <Card>
                            <CardHeader>
                              <div className="flex items-start justify-between gap-3">
                                <div className="space-y-1">
                                  <CardTitle>{stageLabels[selectedStage]}</CardTitle>
                                  <CardDescription>
                                    Сначала проверьте содержание. Включайте редактирование только
                                    при необходимости правок.
                                  </CardDescription>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    variant="outline"
                                    onClick={() => setIsEditing((current) => !current)}
                                    disabled={detailLoading || mutating}
                                  >
                                    <PencilLineIcon data-icon="inline-start" />
                                    {isEditing
                                      ? "Закончить редактирование"
                                      : "Перейти к редактированию"}
                                  </Button>
                                  <Button
                                    variant="secondary"
                                    onClick={() => void handleSaveDraft()}
                                    disabled={mutating || !currentStageArtifact}
                                  >
                                    <SaveIcon data-icon="inline-start" />
                                    Сохранить
                                  </Button>
                                  <Button
                                    onClick={() => void handleApproveStage()}
                                    disabled={mutating || !currentStageArtifact}
                                  >
                                    <CheckCircle2Icon data-icon="inline-start" />
                                    Подтвердить этап
                                  </Button>
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent className="space-y-4">
                              {isEditing ? (
                                <Textarea
                                  value={editorValue}
                                  onChange={(event) => {
                                    setEditorValue(event.target.value)
                                    setIsEditing(true)
                                  }}
                                  className="min-h-[500px] font-mono text-sm"
                                />
                              ) : (
                                <div className="min-h-[500px] rounded-lg border border-border bg-muted/20 p-4">
                                  <pre className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                                    {editorValue || "Пока нет данных для выбранного этапа."}
                                  </pre>
                                </div>
                              )}
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  variant="outline"
                                  onClick={() => void handleDownloadArtifact(selectedStage, "md")}
                                >
                                  <FileTextIcon data-icon="inline-start" />
                                  Скачать Markdown
                                </Button>
                                <Button
                                  variant="outline"
                                  onClick={() =>
                                    void handleDownloadArtifact(selectedStage, "json")
                                  }
                                >
                                  <FileDownIcon data-icon="inline-start" />
                                  Скачать JSON
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        </div>
                      </TabsContent>

                      <TabsContent value="journal" className="pt-4">
                        <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-4">
                          <Card>
                            <CardHeader>
                              <CardTitle>Очередь задач</CardTitle>
                              <CardDescription>
                                История job по этапам и быстрый перезапуск при ошибке.
                              </CardDescription>
                            </CardHeader>
                            <CardContent className="p-0">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Этап</TableHead>
                                    <TableHead>Статус</TableHead>
                                    <TableHead>Создан</TableHead>
                                    <TableHead>Ошибка</TableHead>
                                    <TableHead className="w-[1%]" />
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {jobs.length ? (
                                    jobs.map((job) => (
                                      <TableRow key={job.id}>
                                        <TableCell>{stageLabels[job.stage]}</TableCell>
                                        <TableCell>
                                          <Badge variant={stageStatusBadgeVariant(job.status)}>
                                            {stageBadgeLabel(job.status)}
                                          </Badge>
                                        </TableCell>
                                        <TableCell>{formatDateLabel(job.createdAt)}</TableCell>
                                        <TableCell>
                                          {job.errorText ? (
                                            <Button
                                              variant="link"
                                              className="h-auto px-0"
                                              onClick={() => {
                                                setSelectedJobError(job.errorText || "")
                                                setJobErrorOpen(true)
                                              }}
                                            >
                                              Показать ошибку
                                            </Button>
                                          ) : (
                                            <span className="text-muted-foreground">Без ошибок</span>
                                          )}
                                        </TableCell>
                                        <TableCell>
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => void handleRetryJob(job.id)}
                                            disabled={mutating}
                                          >
                                            Повторить
                                          </Button>
                                        </TableCell>
                                      </TableRow>
                                    ))
                                  ) : (
                                    <TableRow>
                                      <TableCell colSpan={5}>
                                        <div className="py-8 text-center text-sm text-muted-foreground">
                                          История job появится после первого запуска обработки.
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  )}
                                </TableBody>
                              </Table>
                            </CardContent>
                          </Card>

                          <Card>
                            <CardHeader>
                              <CardTitle>Лог курса</CardTitle>
                              <CardDescription>
                                Последние системные события по выбранному курсу.
                              </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-2">
                              {selectedProject.logs.length ? (
                                selectedProject.logs.map((entry, index) => (
                                  <div
                                    key={`${entry}-${index}`}
                                    className={cn(
                                      "rounded-lg border border-border/70 px-3 py-2 text-sm",
                                      index === 0 && "bg-muted/40"
                                    )}
                                  >
                                    {entry}
                                  </div>
                                ))
                              ) : (
                                <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                                  Логов пока нет.
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        </div>
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </>
              ) : null}
            </Card>
          </section>
        </div>
      </div>

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent className="w-full gap-0 sm:max-w-[700px]">
          <SheetHeader className="border-b">
            <SheetTitle>Создать курс</SheetTitle>
            <SheetDescription>
              Укажите название, добавьте контекст и при необходимости загрузите исходные файлы.
            </SheetDescription>
          </SheetHeader>
          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-6 p-4">
              <Alert>
                <AlertCircleIcon />
                <AlertTitle>Пакет материалов</AlertTitle>
                <AlertDescription>
                  Можно загрузить до 5 файлов. После создания курс сразу появится в рабочем
                  списке.
                </AlertDescription>
              </Alert>

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
                  placeholder="Контекст для генерации: целевая аудитория, важные акценты и ограничения."
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="course-files">Файлы курса</Label>
                <Input
                  id="course-files"
                  type="file"
                  multiple
                  onChange={(event) => setCreateFiles(Array.from(event.target.files ?? []))}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {createFiles.length ? (
                  createFiles.map((file) => (
                    <Badge key={`${file.name}-${file.size}`} variant="secondary">
                      {file.name}
                    </Badge>
                  ))
                ) : (
                  <Badge variant="outline">Файлы не выбраны</Badge>
                )}
              </div>

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

      <Dialog open={jobErrorOpen} onOpenChange={setJobErrorOpen}>
        <DialogContent className="max-w-[860px]">
          <DialogHeader>
            <DialogTitle>Текст ошибки job</DialogTitle>
            <DialogDescription>
              Полный лог ошибки для диагностики и повторного запуска.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[420px] overflow-auto rounded-lg border border-border bg-muted/20 p-3">
            <pre className="whitespace-pre-wrap text-sm">{selectedJobError}</pre>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
