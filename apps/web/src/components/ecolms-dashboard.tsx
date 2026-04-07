"use client"

import { useEffect, useMemo, useState } from "react"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
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

function projectStatusBadgeVariant(
  status: ProjectStatus
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "draft":
      return "secondary"
    case "uploaded":
      return "outline"
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

function stageReached(project: ProjectRecord, stage: StageId) {
  return stageOrder.indexOf(project.currentStage) >= stageOrder.indexOf(stage)
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

function ArtifactPresenceBadge({
  label,
  present,
}: {
  label: string
  present: boolean
}) {
  return <Badge variant={present ? "secondary" : "outline"}>{label}</Badge>
}

export function EcolmsDashboard() {
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [projectTotal, setProjectTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedProject, setSelectedProject] =
    useState<ProjectDetailRecord | null>(null)
  const [selectedStage, setSelectedStage] = useState<StageId>("source_compiled")
  const [editorValue, setEditorValue] = useState("")
  const [isEditing, setIsEditing] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
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

      if (createFiles.length > 0) {
        await uploadFilesForProject(created.id, createFiles, "create", 1)
      } else {
        await refreshProjects(1)
        await refreshProject(created.id)
      }

      setCourseName("")
      setCourseNote("")
      setCreateFiles([])
      setCreateOpen(false)
      setDetailOpen(true)
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
    const withFiles = projects.filter((project) => project.sourceFiles.length > 0).length

    return {
      total: projectTotal,
      awaiting,
      completed,
      withFiles,
    }
  }, [projectTotal, projects])

  const createUploadVisible = uploadContext === "create" && uploadPhase !== "idle"
  const detailUploadVisible = uploadContext === "detail" && uploadPhase !== "idle"

  return (
    <>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(15,23,42,0.06),_transparent_24%),linear-gradient(180deg,_rgba(248,250,252,0.96)_0%,_rgba(255,255,255,1)_22%)]">
        <div className="mx-auto flex min-h-screen w-full max-w-[1680px] flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
          <header className="flex flex-col gap-4 border-b border-border/70 pb-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 text-xs uppercase tracking-[0.24em] text-muted-foreground">
                <SparklesIcon className="size-4" />
                EcoLMS
              </div>
              <div className="flex flex-col gap-2">
                <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
                  Курсы и пайплайн генерации
                </h1>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  void refreshProjects(page)
                  if (selectedProject?.id) {
                    void refreshProject(selectedProject.id)
                  }
                }}
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

          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Card size="sm">
              <CardHeader>
                <CardDescription>Всего курсов</CardDescription>
                <CardTitle>{summary.total}</CardTitle>
              </CardHeader>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardDescription>На проверке</CardDescription>
                <CardTitle>{summary.awaiting}</CardTitle>
              </CardHeader>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardDescription>Готово</CardDescription>
                <CardTitle>{summary.completed}</CardTitle>
              </CardHeader>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardDescription>С загруженными файлами</CardDescription>
                <CardTitle>{summary.withFiles}</CardTitle>
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

          <Card className="overflow-hidden">
            <CardHeader className="border-b">
              <CardTitle>Таблица курсов</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[240px]">Курс</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Файлы</TableHead>
                    <TableHead>План</TableHead>
                    <TableHead>Материалы</TableHead>
                    <TableHead>Тест</TableHead>
                    <TableHead>Обновлено</TableHead>
                    <TableHead className="w-[1%]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listLoading ? (
                    Array.from({ length: 6 }).map((_, index) => (
                      <TableRow key={index}>
                        <TableCell colSpan={8}>
                          <div className="flex items-center gap-3 py-2">
                            <Skeleton className="h-10 w-full" />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : projects.length ? (
                    projects.map((project) => (
                      <TableRow
                        key={project.id}
                        data-state={project.id === selectedProject?.id ? "selected" : undefined}
                        className="cursor-pointer"
                        onClick={() => {
                          setSelectedId(project.id)
                          setDetailOpen(true)
                        }}
                      >
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <span className="font-medium">{project.name}</span>
                            <span className="line-clamp-2 text-xs text-muted-foreground">
                              {project.sourceSummary}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={projectStatusBadgeVariant(project.status)}>
                            {projectStatusLabels[project.status]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <ArtifactPresenceBadge
                            label={project.sourceFiles.length ? "Есть" : "Нет"}
                            present={project.sourceFiles.length > 0}
                          />
                        </TableCell>
                        <TableCell>
                          <ArtifactPresenceBadge
                            label={stageReached(project, "course_outline") ? "Есть" : "Нет"}
                            present={stageReached(project, "course_outline")}
                          />
                        </TableCell>
                        <TableCell>
                          <ArtifactPresenceBadge
                            label={stageReached(project, "course_content") ? "Есть" : "Нет"}
                            present={stageReached(project, "course_content")}
                          />
                        </TableCell>
                        <TableCell>
                          <ArtifactPresenceBadge
                            label={stageReached(project, "course_test") ? "Есть" : "Нет"}
                            present={stageReached(project, "course_test")}
                          />
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDateLabel(project.updatedAt)}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm">
                            Открыть
                            <ChevronRightIcon data-icon="inline-end" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={8}>
                        <div className="py-12 text-center text-sm text-muted-foreground">
                          Курсов пока нет. Создайте первый курс и загрузите
                          исходные материалы.
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              <Separator />
              <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
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
        </div>
      </div>

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent className="w-full gap-0 sm:max-w-[680px]">
          <SheetHeader className="border-b">
            <SheetTitle>Создать курс</SheetTitle>
            <SheetDescription>
              Укажите название курса, добавьте комментарий и при необходимости
              сразу загрузите исходные файлы.
            </SheetDescription>
          </SheetHeader>
          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-6 p-4">
              <Alert>
                <AlertCircleIcon />
                <AlertTitle>Пакет материалов</AlertTitle>
                <AlertDescription>
                  Можно загрузить до 5 файлов. После создания курс сразу появится
                  в таблице и будет готов к запуску обработки.
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
                  placeholder="Контекст для команды и генерации: какие материалы внутри, для кого курс и что важно сохранить."
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="course-files">Файлы курса</Label>
                <Input
                  id="course-files"
                  type="file"
                  multiple
                  onChange={(event) =>
                    setCreateFiles(Array.from(event.target.files ?? []))
                  }
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
                      {(formattedValue, value) =>
                        `${formattedValue ?? value ?? 0}%`
                      }
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
              {mutating ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <PlusIcon data-icon="inline-start" />}
              {mutating ? "Создаём курс..." : "Создать курс"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-full gap-0 sm:max-w-[980px]">
          <SheetHeader className="border-b">
            {selectedProject ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <SheetTitle>{selectedProject.name}</SheetTitle>
                  <Badge variant={projectStatusBadgeVariant(selectedProject.status)}>
                    {projectStatusLabels[selectedProject.status]}
                  </Badge>
                </div>
                <SheetDescription>
                  {selectedProject.overview ||
                    "Курс готов к загрузке файлов и последовательной генерации артефактов."}
                </SheetDescription>
              </>
            ) : (
              <>
                <SheetTitle>Детали курса</SheetTitle>
                <SheetDescription>
                  Выберите курс в таблице, чтобы открыть его рабочую область.
                </SheetDescription>
              </>
            )}
          </SheetHeader>

          {detailError ? (
            <div className="border-b p-4">
              <Alert>
                <AlertCircleIcon />
                <AlertTitle>Не удалось загрузить курс</AlertTitle>
                <AlertDescription>{detailError}</AlertDescription>
              </Alert>
            </div>
          ) : null}

          <ScrollArea className="flex-1">
            {!selectedProject && detailLoading ? (
              <div className="flex flex-col gap-4 p-4">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-72 w-full" />
              </div>
            ) : selectedProject ? (
              <Tabs defaultValue="overview" className="gap-0">
                <TabsList variant="line" className="border-b px-4 pt-4">
                  <TabsTrigger value="overview">Обзор</TabsTrigger>
                  <TabsTrigger value="stages">Этапы</TabsTrigger>
                  <TabsTrigger value="journal">Журнал</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="p-4">
                  <div className="flex flex-col gap-6">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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

                    <Card>
                      <CardHeader>
                        <CardTitle>Действия по курсу</CardTitle>
                        <CardDescription>
                          Основные действия для обновления, запуска и выгрузки артефактов.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-4">
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
                            variant="secondary"
                            onClick={() => void handleStartProject()}
                            disabled={!selectedProject.sourceFiles.length || mutating}
                          >
                            <PlayIcon data-icon="inline-start" />
                            Запустить обработку
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => {
                              const exportTarget = currentStageArtifact
                              if (!exportTarget) {
                                return
                              }
                              void handleDownloadArtifact(
                                exportTarget.stage,
                                exportTarget.format
                              )
                            }}
                            disabled={!currentStageArtifact}
                          >
                            <FileDownIcon data-icon="inline-start" />
                            Скачать артефакт
                          </Button>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle>Загрузка файлов</CardTitle>
                        <CardDescription>
                          Добавляйте новые исходники и повторно запускайте
                          обработку по мере обновления курса.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-4">
                        <Alert>
                          <AlertCircleIcon />
                          <AlertTitle>Политика хранения</AlertTitle>
                          <AlertDescription>
                            Итоговые материалы хранятся как артефакты курса, а
                            исходные файлы привязываются к карточке курса.
                          </AlertDescription>
                        </Alert>
                        <div className="flex flex-col gap-2">
                          <Label htmlFor="detail-files">Добавить файлы</Label>
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
                            <Badge variant="outline">Новые файлы не выбраны</Badge>
                          )}
                        </div>
                        {detailUploadVisible ? (
                          <div className="flex flex-col gap-2">
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
                        <div className="flex flex-wrap gap-2">
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
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle>Исходные файлы</CardTitle>
                        <CardDescription>
                          Список файлов, уже привязанных к выбранному курсу.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="p-0">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Файл</TableHead>
                              <TableHead>Тип</TableHead>
                              <TableHead>Статус</TableHead>
                              <TableHead>Размер</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {selectedProject.sourceFiles.length ? (
                              selectedProject.sourceFiles.map((file) => (
                                <TableRow key={file.id}>
                                  <TableCell className="font-medium">
                                    {file.originalName}
                                  </TableCell>
                                  <TableCell className="capitalize">
                                    {file.kind}
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="outline">
                                      {sourceFileStatusLabel(file.uploadStatus)}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>
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

                <TabsContent value="stages" className="p-4">
                  <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
                    <div className="flex flex-col gap-2">
                      {selectedProject.stages.map((stage) => (
                        <Button
                          key={stage.id}
                          type="button"
                          variant={selectedStage === stage.id ? "secondary" : "outline"}
                          className="h-auto justify-between px-3 py-3 text-left"
                          onClick={() => {
                            setSelectedStage(stage.id)
                            setIsEditing(false)
                          }}
                        >
                          <div className="flex min-w-0 flex-col gap-1">
                            <span className="font-medium">{stageLabels[stage.id]}</span>
                            <span className="text-xs text-muted-foreground">
                              {stage.note}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {stage.updatedAt}
                            </span>
                          </div>
                          <Badge variant={stageStatusBadgeVariant(stage.status)}>
                            {stageBadgeLabel(stage.status)}
                          </Badge>
                        </Button>
                      ))}
                    </div>

                    <Card>
                      <CardHeader>
                        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                          <div className="flex flex-col gap-1">
                            <CardTitle>{stageLabels[selectedStage]}</CardTitle>
                            <CardDescription>
                              Редактируйте markdown, сохраняйте правки и
                              подтверждайте этап по мере готовности.
                            </CardDescription>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              onClick={() => setIsEditing((current) => !current)}
                              disabled={detailLoading || mutating}
                            >
                              <PencilLineIcon data-icon="inline-start" />
                              {isEditing ? "Режим редактирования" : "Редактировать"}
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
                      <CardContent className="flex flex-col gap-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">Markdown</Badge>
                        </div>
                        <Textarea
                          value={editorValue}
                          onChange={(event) => {
                            setEditorValue(event.target.value)
                            setIsEditing(true)
                          }}
                          readOnly={!isEditing}
                          className="min-h-[480px] font-mono text-sm"
                        />
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
                            onClick={() => void handleDownloadArtifact(selectedStage, "json")}
                          >
                            <FileDownIcon data-icon="inline-start" />
                            Скачать JSON
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                <TabsContent value="journal" className="p-4">
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                    <Card>
                      <CardHeader>
                        <CardTitle>Очередь и job</CardTitle>
                        <CardDescription>
                          История задач по курсу с возможностью повторного запуска.
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
                                  <TableCell className="max-w-[220px] truncate text-muted-foreground">
                                    {job.errorText ?? "Без ошибок"}
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
                                    История job появится после первого запуска
                                    обработки.
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
                          Последние служебные события по выбранному курсу.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-2">
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
                          <div className="rounded-lg border border-dashed border-border px-3 py-6 text-sm text-muted-foreground">
                            Лог ещё пуст. Он начнёт заполняться после загрузки
                            файлов и запуска обработки.
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>
              </Tabs>
            ) : (
              <div className="p-4 text-sm text-muted-foreground">
                Выберите курс в таблице, чтобы открыть детали.
              </div>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  )
}
