"use client"

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react"
import {
  AlertCircleIcon,
  FileTextIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  SparklesIcon,
  UploadIcon,
  XIcon,
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
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

import {
  abortUpload,
  completeUpload,
  createProject,
  deleteSourceFile,
  generateStage,
  getProject,
  initUpload,
  listProjects,
  projectStatusLabels,
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

type GenerationStage = "course_outline" | "course_content" | "course_test"
const VISIBLE_STAGES: GenerationStage[] = [
  "course_outline",
  "course_content",
  "course_test",
]

type UploadPhase = "idle" | "uploading" | "done" | "error"
type UploadContext = "create" | "detail" | null

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

export function EcolmsDashboard() {
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [projectTotal, setProjectTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedProject, setSelectedProject] =
    useState<ProjectDetailRecord | null>(null)
  const [selectedStage, setSelectedStage] = useState<GenerationStage>("course_outline")
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

  const totalPages = Math.max(1, Math.ceil(projectTotal / PAGE_SIZE))
  const currentStageArtifact = getStageArtifact(selectedProject, selectedStage)

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
          await abortUpload(init.uploadId).catch(() => undefined)
          throw error
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

  async function handleSaveContext() {
    if (!selectedProject) {
      return
    }
    setMutating(true)
    try {
      await updateProject(selectedProject.id, { note: regenerationContext })
      await refreshProjects(page)
      await refreshProject(selectedProject.id)
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
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Не удалось запустить генерацию")
    } finally {
      setMutating(false)
    }
  }

  const summary = useMemo(() => {
    const processing = projects.filter((project) => project.status === "processing").length
    const completed = projects.filter((project) => project.status === "completed").length
    const withFiles = projects.filter((project) => project.sourceFiles.length > 0).length

    return {
      total: projectTotal,
      processing,
      completed,
      withFiles,
    }
  }, [projectTotal, projects])

  const detailUploadVisible = uploadContext === "detail" && uploadPhase !== "idle"
  const createUploadVisible = uploadContext === "create" && uploadPhase !== "idle"

  const canGenerateOutline = Boolean(selectedProject?.sourceFiles.length)
  const canGenerateContent = isStageDone(selectedProject, "course_outline")
  const canGenerateTest = isStageDone(selectedProject, "course_content")

  const generationLabelByStage: Record<GenerationStage, string> = {
    course_outline: "Создать план",
    course_content: "Создать материалы",
    course_test: "Создать тест",
  }

  return (
    <>
      <div className="min-h-screen bg-background">
        <div className="mx-auto flex min-h-screen w-full max-w-[1760px] flex-col gap-5 px-6 py-6">
          <header className="flex items-end justify-between gap-4 border border-border/80 bg-card px-6 py-5">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                <SparklesIcon className="size-4" />
                Конструктор обучающих курсов
              </div>
              <h1 className="font-heading text-3xl font-semibold tracking-tight">
                Рабочее пространство EcoLMS
              </h1>
            </div>
            <div className="flex items-center gap-3">
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
            <Card size="sm">
              <CardHeader>
                <CardDescription>Всего курсов</CardDescription>
                <CardTitle className="text-3xl">{summary.total}</CardTitle>
              </CardHeader>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardDescription>В обработке</CardDescription>
                <CardTitle className="text-3xl">{summary.processing}</CardTitle>
              </CardHeader>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardDescription>Готово</CardDescription>
                <CardTitle className="text-3xl">{summary.completed}</CardTitle>
              </CardHeader>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardDescription>С файлами</CardDescription>
                <CardTitle className="text-3xl">{summary.withFiles}</CardTitle>
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
            <Card className="overflow-hidden border-border/80 bg-card">
              <CardHeader className="border-b bg-secondary/35">
                <CardTitle>Курсы</CardTitle>
                <CardDescription>Список курсов и текущий статус.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[calc(100vh-360px)]">
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
                            "h-auto w-full justify-start rounded-none border-b border-border/60 px-4 py-3 text-left",
                            project.id === selectedProject?.id && "bg-muted"
                          )}
                          onClick={() => setSelectedId(project.id)}
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
                              <span>{stageLabels[project.currentStage]}</span>
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

            <Card className="overflow-hidden border-border/80 bg-card">
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
                  <CardHeader className="border-b bg-secondary/20">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-col gap-2">
                        <CardTitle className="truncate text-2xl">
                          {selectedProject.name}
                        </CardTitle>
                        <CardDescription>
                          {selectedProject.overview ||
                            "Сначала создайте план, затем материалы и тест."}
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={projectStatusBadgeVariant(selectedProject.status)}>
                          {projectStatusLabels[selectedProject.status]}
                        </Badge>
                        <Button
                          variant="outline"
                          onClick={() => setEditOpen(true)}
                          disabled={detailLoading || mutating}
                        >
                          Редактировать
                        </Button>
                      </div>
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
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm text-muted-foreground">
                        Линейная генерация: План → Материалы → Тест
                      </div>
                      <Button
                        variant="outline"
                        onClick={() => void handleGenerate("course_outline", true)}
                        disabled={!canGenerateOutline || mutating}
                      >
                        Запустить всё автоматически
                      </Button>
                    </div>

                    <div className="grid grid-cols-[320px_minmax(0,1fr)] gap-4">
                      <Card>
                        <CardHeader>
                          <CardTitle>Материалы курса</CardTitle>
                          <CardDescription>
                            Выберите блок и запустите генерацию по шагам.
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          {VISIBLE_STAGES.map((stage) => {
                            const stageStatus =
                              selectedProject.stages.find((item) => item.id === stage)?.status ??
                              "queued"
                            const disabledCreate =
                              stage === "course_outline"
                                ? !canGenerateOutline
                                : stage === "course_content"
                                  ? !canGenerateContent
                                  : !canGenerateTest

                            return (
                              <div
                                key={stage}
                                className={cn(
                                  "border px-3 py-3",
                                  selectedStage === stage && "border-primary/60 bg-muted/20"
                                )}
                              >
                                <button
                                  type="button"
                                  className="flex w-full items-start justify-between text-left"
                                  onClick={() => {
                                    setSelectedStage(stage)
                                    setIsEditing(false)
                                  }}
                                >
                                  <div className="space-y-1">
                                    <div className="font-medium">{stageLabels[stage]}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {stageStatus === "done"
                                        ? "Сгенерировано"
                                        : "Ещё не сгенерировано"}
                                    </div>
                                  </div>
                                  <Badge variant={stageStatus === "done" ? "default" : "outline"}>
                                    {stageStatus === "done" ? "Готов" : "Ожидает"}
                                  </Badge>
                                </button>
                                <div className="mt-3">
                                  <Button
                                    size="sm"
                                    variant={stageStatus === "done" ? "outline" : "default"}
                                    onClick={() => void handleGenerate(stage)}
                                    disabled={disabledCreate || mutating}
                                  >
                                    {generationLabelByStage[stage]}
                                  </Button>
                                </div>
                              </div>
                            )
                          })}
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                              <CardTitle>{stageLabels[selectedStage]}</CardTitle>
                              <CardDescription>
                                Можно редактировать и сохранять итоговый текст этапа.
                              </CardDescription>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="outline"
                                onClick={() => setIsEditing((current) => !current)}
                                disabled={detailLoading || mutating}
                              >
                                {isEditing ? "Просмотр" : "Редактировать"}
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() => void handleSaveDraft()}
                                disabled={mutating || !currentStageArtifact}
                              >
                                <SaveIcon data-icon="inline-start" />
                                Сохранить
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          {isEditing ? (
                            <Textarea
                              value={editorValue}
                              onChange={(event) => setEditorValue(event.target.value)}
                              className="min-h-[520px] font-mono text-sm"
                            />
                          ) : (
                            <div className="min-h-[520px] border border-border bg-muted/20 p-4">
                              <pre className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                                {editorValue || "Пока нет данных для выбранного этапа."}
                              </pre>
                            </div>
                          )}
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              onClick={() => void handleGenerate(selectedStage)}
                              disabled={
                                (selectedStage === "course_outline" && !canGenerateOutline) ||
                                (selectedStage === "course_content" && !canGenerateContent) ||
                                (selectedStage === "course_test" && !canGenerateTest) ||
                                mutating
                              }
                            >
                              <FileTextIcon data-icon="inline-start" />
                              {generationLabelByStage[selectedStage]}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
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
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void handleDeleteSourceFile(file.id)}
                                disabled={mutating}
                              >
                                Удалить
                              </Button>
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
    </>
  )
}
