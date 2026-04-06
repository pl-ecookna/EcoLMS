"use client"

import { useEffect, useMemo, useState } from "react"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  FileTextIcon,
  FolderGit2Icon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilLineIcon,
  PlusIcon,
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

const stageOrder = [
  "source_compiled",
  "course_outline",
  "course_content",
  "course_test",
] as const

type StageId = (typeof stageOrder)[number]
type ProjectStatus =
  | "draft"
  | "uploaded"
  | "processing"
  | "awaiting_review"
  | "completed"
  | "failed"
type StageStatus = "queued" | "processing" | "done" | "failed"

const stageLabels: Record<StageId, string> = {
  source_compiled: "Структурированный источник",
  course_outline: "План курса",
  course_content: "Обучающие материалы",
  course_test: "Тест",
}

const projectStatusLabels: Record<ProjectStatus, string> = {
  draft: "Черновик",
  uploaded: "Загружен",
  processing: "В обработке",
  awaiting_review: "На проверке",
  completed: "Готов",
  failed: "Ошибка",
}

const projectStatusVariants: Record<ProjectStatus, "default" | "secondary" | "outline" | "destructive"> =
  {
    draft: "secondary",
    uploaded: "outline",
    processing: "default",
    awaiting_review: "secondary",
    completed: "default",
    failed: "destructive",
  }

type ProjectRecord = {
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
  stages: Array<{
    id: StageId
    status: StageStatus
    note: string
    updatedAt: string
  }>
  artifacts: Array<{
    id: string
    stage: StageId
    format: "md" | "json"
    name: string
    size: string
    storageKey: string
  }>
  logs: string[]
}

function deriveProjectName(template: string, index: number) {
  return `${template} ${index.toString().padStart(2, "0")}`
}

function createDrafts(name: string, topic: string): Record<StageId, string> {
  return {
    source_compiled: `# ${name}\n\n## Что уже известно\n- ${topic}\n- Совмещаем видео и документы в одном проекте.\n- Итог хранится только в S3.\n\n## Что удаляем\n- контакты, если они не нужны для обучения;\n- рекламный шум;\n- повторы из вебинаров.\n`,
    course_outline: `# План курса\n\n1. Введение в ${topic}\n2. Ключевые материалы для продаж и сервиса\n3. Производственный контекст\n4. Типовые ошибки и как их избегать\n5. Проверка понимания\n`,
    course_content: `# Обучающие материалы\n\n## Раздел 1. Введение\nКратко объясняем, зачем нужен материал и кому он адресован.\n\n## Раздел 2. Практика\nДаём пошаговые инструкции без жаргона и лишних деталей.\n`,
    course_test: `# Тест\n\n1. Какой шаг следует после ` + "`source_compiled`" + `?\n   - План курса\n   - Список файлов\n   - Архив проекта\n2. Сколько вопросов должно быть в тесте?\n   - 5\n   - 10\n   - 15\n`,
  }
}

function buildStages(currentStage: StageId, status: ProjectStatus): ProjectRecord["stages"] {
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
      updatedAt: index <= currentIndex ? "сегодня, 09:40" : "ожидает старта",
    }
  })
}

function buildArtifacts(id: string): ProjectRecord["artifacts"] {
  return stageOrder.flatMap((stageId) => [
    {
      id: `${id}-${stageId}-md`,
      stage: stageId,
      format: "md" as const,
      name: `${stageId}.md`,
      size: "24 KB",
      storageKey: `artifacts/${id}/${stageId}.md`,
    },
    {
      id: `${id}-${stageId}-json`,
      stage: stageId,
      format: "json" as const,
      name: `${stageId}.json`,
      size: "12 KB",
      storageKey: `artifacts/${id}/${stageId}.json`,
    },
  ])
}

function buildProjects() {
  const templates = [
    {
      prefix: "EcoGlass sales enablement",
      githubRef: "github.com/pl-ecookna/EcoLMS/issues/218",
      sourceSummary: "Вебинар + PDF для отдела продаж",
      topic: "продаж светопрозрачных конструкций",
      overview: "Материал для менеджеров, которые ведут первые консультации и собирают потребности клиента.",
      status: "awaiting_review" as ProjectStatus,
      currentStage: "course_outline" as StageId,
      progress: 68,
      files: 3,
      updatedAt: "сегодня, 10:18",
      logs: [
        "Загрузка завершена без ошибок.",
        "Из видео извлечено аудио и отправлено в Whisper.",
        "Черновик source_compiled ожидает ручной проверки.",
      ],
    },
    {
      prefix: "Монтаж и сервис",
      githubRef: "github.com/pl-ecookna/EcoLMS/issues/227",
      sourceSummary: "DOC + видеозапись сервисного инструктажа",
      topic: "сервиса и монтажа",
      overview: "Пошаговый разбор типовых работ и контрольных чек-листов для полевой команды.",
      status: "processing" as ProjectStatus,
      currentStage: "course_content" as StageId,
      progress: 44,
      files: 2,
      updatedAt: "вчера, 16:05",
      logs: [
        "Очистка текста завершена.",
        "Сформирован план курса на 6 разделов.",
        "Генерация материалов сейчас в очереди.",
      ],
    },
    {
      prefix: "Производство и качество",
      githubRef: "github.com/pl-ecookna/EcoLMS/issues/233",
      sourceSummary: "PPTX, PDF и стенограмма созвона",
      topic: "производства и контроля качества",
      overview: "Материал для производственных мастеров с акцентом на контроль узлов и брак.",
      status: "uploaded" as ProjectStatus,
      currentStage: "source_compiled" as StageId,
      progress: 18,
      files: 4,
      updatedAt: "вчера, 12:48",
      logs: [
        "Файлы загружены в Beget S3.",
        "Проект готов к запуску обработки.",
        "Ожидается подтверждение от пользователя.",
      ],
    },
    {
      prefix: "Коммерческое предложение",
      githubRef: "github.com/pl-ecookna/EcoLMS/issues/240",
      sourceSummary: "PDF КП и дополнительная презентация",
      topic: "подготовки коммерческих предложений",
      overview: "Пакет материалов для ускоренной подготовки КП на основе реальных документов заказчика.",
      status: "completed" as ProjectStatus,
      currentStage: "course_test" as StageId,
      progress: 100,
      files: 5,
      updatedAt: "понедельник, 09:30",
      logs: [
        "Все этапы подтверждены.",
        "Итоговый пакет сформирован.",
        "Артефакты доступны для скачивания.",
      ],
    },
  ]

  return Array.from({ length: 30 }, (_, index) => {
    const template = templates[index % templates.length]
    const id = `eco-${String(index + 1).padStart(3, "0")}`
    const stageDrafts = createDrafts(
      deriveProjectName(template.prefix, index + 1),
      template.topic
    )

    return {
      id,
      name: deriveProjectName(template.prefix, index + 1),
      githubRef: template.githubRef,
      sourceSummary: template.sourceSummary,
      status:
        index === 0
          ? template.status
          : (["draft", "uploaded", "processing", "awaiting_review", "completed"][
              index % 5
            ] as ProjectStatus),
      currentStage:
        index === 0
          ? template.currentStage
          : stageOrder[index % stageOrder.length],
      progress: index === 0 ? template.progress : [14, 36, 59, 100][index % 4],
      files: index === 0 ? template.files : 1 + (index % 5),
      updatedAt: index === 0 ? template.updatedAt : `${index + 1} апреля, 08:${String(10 + index).padStart(2, "0")}`,
      overview:
        index === 0
          ? template.overview
          : `${template.overview} Этот проект используется как пример в списке.`,
      stageDrafts,
      stages: buildStages(index === 0 ? template.currentStage : stageOrder[index % 4], index === 0 ? template.status : (["draft", "uploaded", "processing", "awaiting_review", "completed"][index % 5] as ProjectStatus)),
      artifacts: buildArtifacts(id),
      logs: index === 0 ? template.logs : template.logs.map((entry) => `${entry} (${index + 1})`),
    } satisfies ProjectRecord
  })
}

const initialProjects = buildProjects()

function statusBadgeVariant(status: StageStatus) {
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

function projectStatusBadgeVariant(status: ProjectStatus) {
  return projectStatusVariants[status]
}

function makeGithubName(value: string) {
  const cleaned = value
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")
  const slug = cleaned.split("/").slice(-1)[0] || "project"
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function EcolmsDashboard() {
  const [projects, setProjects] = useState(initialProjects)
  const [selectedId, setSelectedId] = useState(initialProjects[0].id)
  const [selectedStage, setSelectedStage] = useState<StageId>(
    initialProjects[0].currentStage
  )
  const [isEditing, setIsEditing] = useState(false)
  const [editorValue, setEditorValue] = useState(
    initialProjects[0].stageDrafts[initialProjects[0].currentStage]
  )
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [githubUrl, setGithubUrl] = useState("")
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])

  const pageSize = 25
  const totalPages = Math.max(1, Math.ceil(projects.length / pageSize))
  const pageProjects = useMemo(
    () => projects.slice((page - 1) * pageSize, page * pageSize),
    [page, projects]
  )
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedId) ?? projects[0],
    [projects, selectedId]
  )
  const uploadProgress = selectedFiles.length
    ? Math.min(100, Math.round((selectedFiles.length / 5) * 100))
    : 0

  useEffect(() => {
    setSelectedStage(selectedProject.currentStage)
    setEditorValue(selectedProject.stageDrafts[selectedProject.currentStage])
    setIsEditing(false)
  }, [selectedProject])

  useEffect(() => {
    setEditorValue(selectedProject.stageDrafts[selectedStage])
  }, [selectedStage, selectedProject])

  function updateSelectedProject(
    updater: (project: ProjectRecord) => ProjectRecord
  ) {
    setProjects((current) =>
      current.map((project) =>
        project.id === selectedProject.id ? updater(project) : project
      )
    )
  }

  function handleSaveDraft() {
    updateSelectedProject((project) => ({
      ...project,
      stageDrafts: {
        ...project.stageDrafts,
        [selectedStage]: editorValue,
      },
      updatedAt: "только что",
      logs: [`Сохранена последняя версия этапа ${stageLabels[selectedStage]}.`, ...project.logs].slice(0, 5),
    }))
    setIsEditing(false)
  }

  function handleApproveStage() {
    const currentIndex = stageOrder.indexOf(selectedStage)
    const nextStage = stageOrder[currentIndex + 1]

    updateSelectedProject((project) => {
      const nextStages = project.stages.map((stage) =>
        stage.id === selectedStage
          ? { ...stage, status: "done" as StageStatus, updatedAt: "только что" }
          : stage.id === nextStage
            ? { ...stage, status: "processing" as StageStatus, updatedAt: "ожидает генерации" }
            : stage
      )

      return {
        ...project,
        status: nextStage ? "processing" : "completed",
        currentStage: nextStage ?? selectedStage,
        progress: nextStage ? Math.min(100, project.progress + 18) : 100,
        stages: nextStages,
        updatedAt: "только что",
        logs: [`Этап ${stageLabels[selectedStage]} подтвержден.`, ...project.logs].slice(0, 5),
      }
    })

    if (nextStage) {
      setSelectedStage(nextStage)
      setEditorValue(selectedProject.stageDrafts[nextStage])
    }
    setIsEditing(false)
  }

  function handleCreateProject() {
    const derivedName = makeGithubName(githubUrl) || "new project"
    const newProject: ProjectRecord = {
      id: `eco-${String(projects.length + 1).padStart(3, "0")}`,
      name: deriveProjectName(derivedName, projects.length + 1),
      githubRef: githubUrl || "github.com/pl-ecookna/EcoLMS/issues/new",
      sourceSummary: "Новый проект, ожидающий загрузки материалов",
      status: "draft",
      currentStage: "source_compiled",
      progress: 0,
      files: selectedFiles.length,
      updatedAt: "только что",
      overview:
        "Создан новый проект. После загрузки файлов можно запускать обработку.",
      stageDrafts: createDrafts(
        deriveProjectName(derivedName, projects.length + 1),
        "нового обучающего курса"
      ),
      stages: buildStages("source_compiled", "draft"),
      artifacts: buildArtifacts(`eco-${String(projects.length + 1).padStart(3, "0")}`),
      logs: ["Проект создан из GitHub-источника."],
    }

    setProjects((current) => [newProject, ...current])
    setSelectedId(newProject.id)
    setCreateOpen(false)
    setGithubUrl("")
  }

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
            <Button variant="outline">
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
                    Название проекта формируется из GitHub-источника и не
                    редактируется вручную.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="github-url">GitHub-источник</Label>
                    <Input
                      id="github-url"
                      value={githubUrl}
                      onChange={(event) => setGithubUrl(event.target.value)}
                      placeholder="https://github.com/..."
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="project-name">Название проекта</Label>
                    <Input
                      id="project-name"
                      value={makeGithubName(githubUrl) || "Будет рассчитано автоматически"}
                      readOnly
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="project-note">Комментарий</Label>
                    <Textarea
                      id="project-note"
                      placeholder="Например: материалы по продаже и монтажу изделий для отдела продаж."
                      className="min-h-24"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateOpen(false)}>
                    Отмена
                  </Button>
                  <Button onClick={handleCreateProject}>Создать</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Card size="sm">
            <CardHeader>
              <CardDescription>Всего проектов</CardDescription>
              <CardTitle>{projects.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>На проверке</CardDescription>
              <CardTitle>
                {projects.filter((project) => project.status === "awaiting_review").length}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>Готовые пакеты</CardDescription>
              <CardTitle>
                {projects.filter((project) => project.status === "completed").length}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>Файлы в текущей партии</CardDescription>
              <CardTitle>{selectedFiles.length}/5</CardTitle>
            </CardHeader>
          </Card>
        </section>

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
                <Button variant="outline" disabled={!selectedFiles.length}>
                  <UploadIcon data-icon="inline-start" />
                  Инициализировать загрузку
                </Button>
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
                    {pageProjects.map((project) => (
                      <TableRow
                        key={project.id}
                        data-state={project.id === selectedProject.id ? "selected" : undefined}
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
                    ))}
                  </TableBody>
                </Table>
                <Separator />
                <div className="flex items-center justify-between px-4 py-4">
                  <div className="text-sm text-muted-foreground">
                    Показаны {Math.min(projects.length, (page - 1) * pageSize + 1)}-
                    {Math.min(page * pageSize, projects.length)} из {projects.length}
                  </div>
                  <Pagination className="mx-0 w-auto justify-end">
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          href="#"
                          onClick={(event) => {
                            event.preventDefault()
                            setPage((current) => Math.max(1, current - 1))
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
                            setPage((current) => Math.min(totalPages, current + 1))
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
                      {selectedProject.files} файла
                    </span>
                    <span>{selectedProject.updatedAt}</span>
                  </div>
                </div>
                <div className="flex min-w-[320px] flex-col gap-3">
                  <Progress
                    value={selectedProject.progress}
                    className="flex flex-col gap-2"
                  >
                    <ProgressLabel>Готовность полного пакета</ProgressLabel>
                    <ProgressValue>
                      {(formattedValue, value) =>
                        `${formattedValue ?? value ?? 0}%`
                      }
                    </ProgressValue>
                  </Progress>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setIsEditing((current) => !current)}
                    >
                      <PencilLineIcon data-icon="inline-start" />
                      {isEditing ? "Редактирование включено" : "Редактировать"}
                    </Button>
                    <Button variant="secondary" onClick={handleSaveDraft}>
                      <SaveIcon data-icon="inline-start" />
                      Сохранить
                    </Button>
                    <Button onClick={handleApproveStage}>
                      <CheckCircle2Icon data-icon="inline-start" />
                      Подтвердить
                    </Button>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Tabs defaultValue="stages" className="gap-0">
                <TabsList variant="line" className="border-b px-4 pt-4">
                  <TabsTrigger value="stages">Этапы</TabsTrigger>
                  <TabsTrigger value="artifacts">Артефакты</TabsTrigger>
                  <TabsTrigger value="journal">Журнал</TabsTrigger>
                </TabsList>

                <TabsContent value="stages" className="p-4">
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
                            selectedStage === stage.id && "border-foreground/30 bg-muted/40"
                          )}
                        >
                          <div className="flex min-w-0 flex-col gap-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{stageLabels[stage.id]}</span>
                              <Badge variant={statusBadgeVariant(stage.status)}>
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
                        onChange={(event) => setEditorValue(event.target.value)}
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
                        <Button variant="secondary" onClick={handleSaveDraft}>
                          <SaveIcon data-icon="inline-start" />
                          Сохранить черновик
                        </Button>
                        <Button onClick={handleApproveStage}>
                          <CheckCircle2Icon data-icon="inline-start" />
                          Подтвердить этап
                        </Button>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="artifacts" className="p-4">
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
                              <TableHead className="text-right">Статус</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {selectedProject.artifacts.map((artifact) => (
                              <TableRow key={artifact.id}>
                                <TableCell>
                                  <div className="flex flex-col gap-1">
                                    <span className="font-medium">{artifact.name}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {artifact.storageKey}
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell>{stageLabels[artifact.stage]}</TableCell>
                                <TableCell>{artifact.size}</TableCell>
                                <TableCell className="text-right">
                                  <Badge variant="secondary">Готов</Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline">
                        <FileTextIcon data-icon="inline-start" />
                        Скачать Markdown
                      </Button>
                      <Button variant="outline">
                        <FileTextIcon data-icon="inline-start" />
                        Скачать JSON
                      </Button>
                      <Button>
                        <SparklesIcon data-icon="inline-start" />
                        Собрать полный пакет
                      </Button>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="journal" className="p-4">
                  <div className="grid gap-4">
                    <Alert>
                      <Loader2Icon />
                      <AlertTitle>Текущий статус</AlertTitle>
                      <AlertDescription>
                        Обработка выполняется последовательно, следующий этап
                        запускается только после подтверждения.
                      </AlertDescription>
                    </Alert>
                    <ScrollArea className="h-[540px] rounded-xl border">
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
                  </div>
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
