"use client"

import { useEffect, useMemo, useState } from "react"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  FileDownIcon,
  FileTextIcon,
  FolderGit2Icon,
  Loader2Icon,
  MoreHorizontalIcon,
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  startProject,
  retryJob,
  signUploadPart,
  stageLabels,
  updateArtifact,
  type ProjectDetailRecord,
  type ProjectRecord,
  type ProjectStatus,
  type StageId,
  type ProcessingJobRecord,
} from "@/lib/ecolms-api"

const PAGE_SIZE = 25
const PART_SIZE_BYTES = 10 * 1024 * 1024

type UploadPhase = "idle" | "uploading" | "done" | "error"

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

function makeGithubName(value: string) {
  const cleaned = value
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")

  const slug = cleaned.split("/").filter(Boolean).at(-1) || "project"
  return slug.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
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
  const [githubRef, setGithubRef] = useState("")
  const [projectNote, setProjectNote] = useState("")
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [mutating, setMutating] = useState(false)
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle")
  const [uploadMessage, setUploadMessage] = useState("")
  const [uploadProgress, setUploadProgress] = useState(0)
  const [listError, setListError] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  const totalPages = Math.max(1, Math.ceil(projectTotal / PAGE_SIZE))
  const pageProjects = useMemo(() => projects, [projects])
  const jobs = useMemo(
    () => latestJobs(selectedProject?.jobs ?? []),
    [selectedProject]
  )
  const currentStageArtifact = getStageArtifact(selectedProject, selectedStage, "md")

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
      setListError(error instanceof Error ? error.message : "Не удалось загрузить проекты")
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
      setDetailError(error instanceof Error ? error.message : "Не удалось загрузить проект")
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

  async function handleCreateProject() {
    if (!githubRef.trim()) {
      return
    }

    setMutating(true)
    try {
      const created = await createProject({
        githubRef: githubRef.trim(),
        note: projectNote.trim() || undefined,
      })

      setCreateOpen(false)
      setGithubRef("")
      setProjectNote("")
      setSelectedFiles([])
      setPage(1)
      setSelectedId(created.id)
      setSelectedProject(created)
      setSelectedStage(created.currentStage)
      setEditorValue(getStageMarkdown(created, created.currentStage))

      await refreshProjects(1)
    } finally {
      setMutating(false)
    }
  }

  async function handleUploadFiles() {
    if (!selectedProject || selectedFiles.length === 0) {
      return
    }

    setUploadPhase("uploading")
    setUploadMessage("Инициализируем multipart upload")
    setUploadProgress(0)

    const totalChunks = selectedFiles.reduce(
      (sum, file) => sum + Math.max(1, Math.ceil(file.size / PART_SIZE_BYTES)),
      0
    )
    let completedChunks = 0

    try {
      for (const file of selectedFiles) {
        const init = await initUpload(selectedProject.id, {
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
            const response = await fetch("/api/s3-upload", {
              method: signed.method || "PUT",
              headers: {
                "x-target-url": signed.signedUrl,
                ...(signed.headers ?? {}),
              },
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
      setSelectedFiles([])

      await refreshProjects(page)
      if (selectedProject?.id) {
        await refreshProject(selectedProject.id)
      }
    } catch (error) {
      setUploadPhase("error")
      setUploadMessage(
        error instanceof Error ? error.message : "Не удалось загрузить файлы"
      )
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
    if (!selectedProject) {
      return
    }

    const artifact = currentStageArtifact
    if (!artifact) {
      return
    }

    setMutating(true)
    try {
      await updateArtifact(selectedProject.id, artifact.id, editorValue)
      await refreshProjects(page)
      await refreshProject(selectedProject.id)
    } finally {
      setMutating(false)
    }
  }

  async function handleApproveStage() {
    if (!selectedProject) {
      return
    }

    const artifact = currentStageArtifact
    if (!artifact) {
      return
    }

    setMutating(true)
    try {
      const response = await approveArtifact(selectedProject.id, artifact.id)
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
    return {
      total: projectTotal,
      awaiting,
      completed,
    }
  }, [projectTotal, projects])

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(0,0,0,0.05),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(0,0,0,0.03),_transparent_22%)]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1680px] flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-border/60 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              <SparklesIcon className="size-4" />
              EcoLMS
            </div>
            <div className="flex flex-col gap-2">
              <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
                Управление курсами и этапами генерации
              </h1>
              <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                Внутренний контур для загрузки материалов, ручной проверки
                Markdown и последовательной генерации курса, материалов и теста.
              </p>
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
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger
                render={
                  <Button>
                    <PlusIcon data-icon="inline-start" />
                    Новый проект
                  </Button>
                }
              />
              <DialogContent className="sm:max-w-[560px]">
                <DialogHeader>
                  <DialogTitle>Создать проект</DialogTitle>
                  <DialogDescription>
                    Название проекта будет собрано автоматически из GitHub-источника.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="github-url">GitHub-источник</Label>
                    <Input
                      id="github-url"
                      value={githubRef}
                      onChange={(event) => setGithubRef(event.target.value)}
                      placeholder="https://github.com/..."
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="project-name">Предпросмотр имени</Label>
                    <Input
                      id="project-name"
                      value={makeGithubName(githubRef) || "Будет рассчитано автоматически"}
                      readOnly
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="project-note">Комментарий</Label>
                    <Textarea
                      id="project-note"
                      placeholder="Например: материалы по продаже и монтажу изделий для отдела продаж."
                      className="min-h-24"
                      value={projectNote}
                      onChange={(event) => setProjectNote(event.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateOpen(false)}>
                    Отмена
                  </Button>
                  <Button onClick={() => void handleCreateProject()} disabled={mutating}>
                    {mutating ? "Создаём..." : "Создать"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Card size="sm">
            <CardHeader>
              <CardDescription>Всего проектов</CardDescription>
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
              <CardDescription>Готовые пакеты</CardDescription>
              <CardTitle>{summary.completed}</CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>Файлы в текущей партии</CardDescription>
              <CardTitle>{selectedFiles.length}/5</CardTitle>
            </CardHeader>
          </Card>
        </section>

        {listError ? (
          <Alert>
            <AlertCircleIcon />
            <AlertTitle>Не удалось загрузить список проектов</AlertTitle>
            <AlertDescription>{listError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Загрузка файлов</CardTitle>
                <CardDescription>
                  До 5 файлов в проекте, прямой multipart upload в Beget S3.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Alert>
                  <AlertCircleIcon />
                  <AlertTitle>Политика хранения</AlertTitle>
                  <AlertDescription>
                    Очистка артефактов выполняется раз в неделю только для
                    проектов, у которых уже собран полный пакет.
                  </AlertDescription>
                </Alert>
                <div className="grid gap-2">
                  <Label htmlFor="project-files">Добавить файлы</Label>
                  <Input
                    id="project-files"
                    type="file"
                    multiple
                    onChange={(event) =>
                      setSelectedFiles(Array.from(event.target.files ?? []))
                    }
                  />
                </div>
                <Progress value={uploadProgress} className="flex flex-col gap-2">
                  <ProgressLabel>Подготовка загрузки</ProgressLabel>
                  <ProgressValue>
                    {(formattedValue, value) =>
                      `${formattedValue ?? value ?? 0}%`
                    }
                  </ProgressValue>
                </Progress>
                {uploadMessage ? (
                  <div className="text-xs text-muted-foreground">{uploadMessage}</div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {selectedFiles.length ? (
                    selectedFiles.map((file) => (
                      <Badge key={file.name} variant="secondary">
                        {file.name}
                      </Badge>
                    ))
                  ) : (
                    <Badge variant="outline">Файлы еще не выбраны</Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={!selectedProject || !selectedFiles.length || uploadPhase === "uploading"}
                    onClick={() => void handleUploadFiles()}
                  >
                    <UploadIcon data-icon="inline-start" />
                    {uploadPhase === "uploading" ? "Загрузка..." : "Загрузить в S3"}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={!selectedProject || !selectedProject.sourceFiles.length || mutating}
                    onClick={() => void handleStartProject()}
                  >
                    <PlayIcon data-icon="inline-start" />
                    Запустить обработку
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="flex-1">
              <CardHeader className="border-b">
                <CardTitle>Проекты</CardTitle>
                <CardDescription>
                  Страница показывает по 25 карточек. Для внутреннего MVP этого
                  достаточно.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Проект</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead className="text-right">Этап</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listLoading ? (
                      Array.from({ length: 5 }).map((_, index) => (
                        <TableRow key={index}>
                          <TableCell colSpan={3}>
                            <div className="flex items-center gap-3 py-1">
                              <div className="h-4 w-36 animate-pulse rounded bg-muted" />
                              <div className="h-4 w-20 animate-pulse rounded bg-muted" />
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : pageProjects.length ? (
                      pageProjects.map((project) => (
                        <TableRow
                          key={project.id}
                          data-state={project.id === selectedProject?.id ? "selected" : undefined}
                          className="cursor-pointer"
                          onClick={() => setSelectedId(project.id)}
                        >
                          <TableCell className="max-w-[190px]">
                            <div className="flex flex-col gap-1">
                              <span className="truncate font-medium">{project.name}</span>
                              <span className="truncate text-xs text-muted-foreground">
                                {project.sourceSummary}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={projectStatusBadgeVariant(project.status)}>
                              {projectStatusLabels[project.status]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {stageLabels[project.currentStage]}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={3}>
                          <div className="py-10 text-center text-sm text-muted-foreground">
                            Проектов пока нет. Создайте первый проект или обновите список.
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                <Separator />
                <div className="flex items-center justify-between px-4 py-4">
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

          <Card className="min-h-[780px]">
            <CardHeader className="border-b">
              {selectedProject ? (
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="truncate">{selectedProject.name}</CardTitle>
                      <Badge variant={projectStatusBadgeVariant(selectedProject.status)}>
                        {projectStatusLabels[selectedProject.status]}
                      </Badge>
                    </div>
                    <CardDescription>{selectedProject.overview}</CardDescription>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <FolderGit2Icon className="size-3.5" />
                        {selectedProject.githubRef}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <FileTextIcon className="size-3.5" />
                        {selectedProject.sourceFiles.length} файла
                      </span>
                      <span>{selectedProject.updatedAt}</span>
                    </div>
                  </div>
                  <div className="flex min-w-[320px] flex-col gap-3">
                    <Progress value={selectedProject.progress} className="flex flex-col gap-2">
                      <ProgressLabel>Готовность полного пакета</ProgressLabel>
                      <ProgressValue>
                        {(formattedValue, value) =>
                          `${formattedValue ?? value ?? 0}%`
                        }
                      </ProgressValue>
                    </Progress>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setIsEditing((current) => !current)}
                        disabled={detailLoading || mutating}
                      >
                        <PencilLineIcon data-icon="inline-start" />
                        {isEditing ? "Редактирование включено" : "Редактировать"}
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
                        Подтвердить
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          void refreshProjects(page)
                          void refreshProject(selectedProject.id)
                        }}
                        disabled={detailLoading || mutating}
                      >
                        <RefreshCwIcon data-icon="inline-start" />
                        Обновить проект
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          const exportTarget = currentStageArtifact
                          if (!exportTarget) {
                            return
                          }
                          void handleDownloadArtifact(exportTarget.stage, exportTarget.format)
                        }}
                        disabled={!currentStageArtifact}
                      >
                        <FileDownIcon data-icon="inline-start" />
                        Скачать артефакт
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <CardTitle>Нет выбранного проекта</CardTitle>
                  <CardDescription>
                    Создайте проект или выберите его из списка слева.
                  </CardDescription>
                </div>
              )}
            </CardHeader>

            <CardContent className="p-0">
              {detailError ? (
                <div className="p-4">
                  <Alert>
                    <AlertCircleIcon />
                    <AlertTitle>Не удалось загрузить проект</AlertTitle>
                    <AlertDescription>{detailError}</AlertDescription>
                  </Alert>
                </div>
              ) : null}

              <Tabs defaultValue="stages" className="gap-0">
                <TabsList variant="line" className="border-b px-4 pt-4">
                  <TabsTrigger value="stages">Этапы</TabsTrigger>
                  <TabsTrigger value="artifacts">Артефакты</TabsTrigger>
                  <TabsTrigger value="journal">Журнал</TabsTrigger>
                </TabsList>

                <TabsContent value="stages" className="p-4">
                  {selectedProject ? (
                    <div className="grid gap-4 xl:grid-cols-[1.1fr_minmax(0,1fr)]">
                      <div className="grid gap-3">
                        {selectedProject.stages.map((stage) => (
                          <button
                            key={stage.id}
                            type="button"
                            onClick={() => {
                              setSelectedStage(stage.id)
                              setIsEditing(false)
                            }}
                            className={cn(
                              "flex items-start justify-between gap-3 rounded-xl border p-4 text-left transition hover:bg-muted/40",
                              selectedStage === stage.id &&
                                "border-foreground/30 bg-muted/40"
                            )}
                          >
                            <div className="flex min-w-0 flex-col gap-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">{stageLabels[stage.id]}</span>
                                <Badge variant={stageStatusBadgeVariant(stage.status)}>
                                  {stage.status === "done"
                                    ? "Готов"
                                    : stage.status === "processing"
                                      ? "В работе"
                                      : stage.status === "failed"
                                        ? "Ошибка"
                                        : "Ожидает"}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground">{stage.note}</p>
                              <span className="text-xs text-muted-foreground">
                                {stage.updatedAt}
                              </span>
                            </div>
                            <MoreHorizontalIcon className="mt-0.5 size-4 text-muted-foreground" />
                          </button>
                        ))}
                      </div>

                      <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                          <div className="flex flex-col gap-1">
                            <div className="text-sm font-medium">
                              {stageLabels[selectedStage]}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Последняя версия хранится только как итоговый черновик.
                            </div>
                          </div>
                          <Badge variant="outline">Markdown</Badge>
                        </div>
                        <Textarea
                          value={editorValue}
                          onChange={(event) => {
                            setEditorValue(event.target.value)
                            setIsEditing(true)
                          }}
                          readOnly={!isEditing}
                          className="min-h-[420px] font-mono text-sm"
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant="outline"
                            onClick={() => setIsEditing(true)}
                            disabled={isEditing}
                          >
                            <PencilLineIcon data-icon="inline-start" />
                            Редактировать
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => void handleSaveDraft()}
                            disabled={mutating || !currentStageArtifact}
                          >
                            <SaveIcon data-icon="inline-start" />
                            Сохранить черновик
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
                    </div>
                  ) : (
                    <div className="rounded-xl border p-10 text-center text-sm text-muted-foreground">
                      Выберите проект, чтобы увидеть этапы.
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="artifacts" className="p-4">
                  {selectedProject ? (
                    <div className="grid gap-4">
                      <Alert>
                        <CheckCircle2Icon />
                        <AlertTitle>Артефакты хранятся только в S3</AlertTitle>
                        <AlertDescription>
                          В PostgreSQL лежат только метаданные и ссылки на файлы.
                        </AlertDescription>
                      </Alert>
                      <Card size="sm">
                        <CardContent className="p-0">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Файл</TableHead>
                                <TableHead>Этап</TableHead>
                                <TableHead>Размер</TableHead>
                                <TableHead className="text-right">Действия</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {selectedProject.artifacts.map((artifact) => (
                                <TableRow key={artifact.id}>
                                  <TableCell>
                                    <div className="flex flex-col gap-1">
                                      <span className="font-medium">
                                        {artifact.stage}.{artifact.format}
                                      </span>
                                      <span className="text-xs text-muted-foreground">
                                        {artifact.storageKey}
                                      </span>
                                    </div>
                                  </TableCell>
                                  <TableCell>{stageLabels[artifact.stage]}</TableCell>
                                  <TableCell>
                                    {artifact.format === "md" ? "Markdown" : "JSON"}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() =>
                                        void handleDownloadArtifact(
                                          artifact.stage,
                                          artifact.format
                                        )
                                      }
                                    >
                                      <FileDownIcon data-icon="inline-start" />
                                      Скачать
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </CardContent>
                      </Card>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            const artifact = getStageArtifact(selectedProject, selectedStage, "md")
                            if (artifact) {
                              setEditorValue(artifact.contentMd)
                              setIsEditing(true)
                            }
                          }}
                        >
                          <FileTextIcon data-icon="inline-start" />
                          Открыть Markdown
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            const artifact = getStageArtifact(selectedProject, selectedStage, "md")
                            if (artifact) {
                              setEditorValue(artifact.contentMd)
                            }
                          }}
                        >
                          <RefreshCwIcon data-icon="inline-start" />
                          Обновить редактор
                        </Button>
                        <Button
                          onClick={() => void handleApproveStage()}
                          disabled={mutating || !currentStageArtifact}
                        >
                          <SparklesIcon data-icon="inline-start" />
                          Собрать следующий этап
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border p-10 text-center text-sm text-muted-foreground">
                      Выберите проект, чтобы увидеть артефакты.
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="journal" className="p-4">
                  {selectedProject ? (
                    <div className="grid gap-4">
                      <Alert>
                        <Loader2Icon />
                        <AlertTitle>Текущий статус</AlertTitle>
                        <AlertDescription>
                          Обработка выполняется последовательно, следующий этап
                          запускается только после подтверждения.
                        </AlertDescription>
                      </Alert>
                      <Card size="sm">
                        <CardHeader>
                          <CardTitle className="text-base">Логи проекта</CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                          <ScrollArea className="h-[280px] rounded-b-xl border-t">
                            <div className="flex flex-col gap-3 p-4">
                              {selectedProject.logs.map((entry, index) => (
                                <div
                                  key={`${selectedProject.id}-log-${index}`}
                                  className="rounded-lg border bg-background px-3 py-2 text-sm"
                                >
                                  {entry}
                                </div>
                              ))}
                            </div>
                          </ScrollArea>
                        </CardContent>
                      </Card>
                      <Card size="sm">
                        <CardHeader>
                          <CardTitle className="text-base">Jobs</CardTitle>
                          <CardDescription>
                            Очередь обработки и повторные запуски.
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Этап</TableHead>
                                <TableHead>Статус</TableHead>
                                <TableHead>Создан</TableHead>
                                <TableHead className="text-right">Действия</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {jobs.length ? (
                                jobs.map((job) => (
                                  <TableRow key={job.id}>
                                    <TableCell>{stageLabels[job.stage]}</TableCell>
                                    <TableCell>
                                      <Badge variant={stageStatusBadgeVariant(job.status)}>
                                        {job.status}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                      {new Date(job.createdAt).toLocaleString("ru-RU")}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={job.status !== "failed" || mutating}
                                        onClick={() => void handleRetryJob(job.id)}
                                      >
                                        <RefreshCwIcon data-icon="inline-start" />
                                        Retry
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                ))
                              ) : (
                                <TableRow>
                                  <TableCell colSpan={4}>
                                    <div className="py-10 text-center text-sm text-muted-foreground">
                                      Пока нет jobs.
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </CardContent>
                      </Card>
                    </div>
                  ) : (
                    <div className="rounded-xl border p-10 text-center text-sm text-muted-foreground">
                      Выберите проект, чтобы увидеть журнал.
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        <footer className="flex flex-col gap-3 border-t border-border/60 py-4 text-sm text-muted-foreground lg:flex-row lg:items-center lg:justify-between">
          <div>
            EcoLMS рассчитан на небольшой внутренний контур: до 5 пользователей и
            до 100 генераций в месяц.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Beget S3</Badge>
            <Badge variant="outline">PostgreSQL</Badge>
            <Badge variant="outline">Redis</Badge>
            <Badge variant="outline">Dokploy</Badge>
          </div>
        </footer>
      </div>
    </div>
  )
}
