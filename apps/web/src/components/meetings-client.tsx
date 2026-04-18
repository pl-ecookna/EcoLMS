"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import {
  ArrowLeftIcon,
  CopyIcon,
  DownloadIcon,
  FileTextIcon,
  Loader2Icon,
  InfoIcon,
  RefreshCwIcon,
  SaveIcon,
  SparklesIcon,
  SquarePenIcon,
  MoreHorizontalIcon,
  VideoIcon,
  WandSparklesIcon,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"
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
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  meetingStageLabels,
  type MeetingArtifactRecord,
  type MeetingDetailRecord,
  type MeetingJobRecord,
  type MeetingListRecord,
  type MeetingSpeakerRecord,
  type MeetingStageId,
  type MeetingStatus,
  type PaginatedMeetings,
  deleteMeeting,
  updateMeetingSpeaker,
} from "@/lib/ecolms-api"

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "—"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function formatDuration(seconds: number | null | undefined) {
  if (seconds == null) {
    return "—"
  }

  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  const restSeconds = total % 60

  if (hours > 0) {
    return `${hours} ч ${restMinutes} мин`
  }

  return `${restMinutes} мин ${restSeconds.toString().padStart(2, "0")} с`
}

function meetingStatusLabel(status: MeetingStatus) {
  switch (status) {
    case "draft":
      return "Черновик"
    case "uploaded":
      return "Загружена"
    case "processing":
      return "Обработка"
    case "completed":
      return "Готово"
    case "failed":
      return "Ошибка"
  }
}

function meetingStatusVariant(
  status: MeetingStatus
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

function jobStatusLabel(status: MeetingJobRecord["status"]) {
  switch (status) {
    case "queued":
      return "В очереди"
    case "processing":
      return "В работе"
    case "done":
      return "Готово"
    case "failed":
      return "Ошибка"
  }
}

function jobStatusVariant(
  status: MeetingJobRecord["status"]
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "queued":
      return "outline"
    case "processing":
      return "default"
    case "done":
      return "secondary"
    case "failed":
      return "destructive"
  }
}

function stageTitle(stage: MeetingStageId) {
  return meetingStageLabels[stage]
}

function sourceFileLabel(meeting: MeetingListRecord | MeetingDetailRecord) {
  return meeting.sourceFile?.originalName ?? "Файл не загружен"
}

function getArtifact(
  meeting: MeetingDetailRecord | null,
  stage: MeetingStageId
): MeetingArtifactRecord | undefined {
  return meeting?.artifacts.find(
    (artifact) => artifact.stage === stage && artifact.format === "md"
  )
}

function normalizeMarkdownSection(text: string, fallback: string) {
  const trimmed = text.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

type ActionItem = {
  text?: string
  title?: string
  assignee?: string
  deadline?: string
}

function getActionsItems(meeting: MeetingDetailRecord | null) {
  const artifact = meeting?.artifacts.find(
    (item) => item.stage === "meeting_actions" && item.format === "json"
  )
  const actionItems = artifact?.contentJson?.actionItems
  if (!Array.isArray(actionItems)) {
    return []
  }

  return actionItems as ActionItem[]
}

function formatActionItem(item: ActionItem) {
  const text = item.title?.trim() || item.text?.trim() || "Поручение"
  const details = [item.assignee?.trim(), item.deadline?.trim()]
    .filter(Boolean)
    .map((value, index) => {
      if (index === 0) {
        return `ответственный: ${value}`
      }
      return `дедлайн: ${value}`
    })

  if (details.length === 0) {
    return `- ${text}`
  }

  return `- ${text} (${details.join(", ")})`
}

function buildReadableMarkdown(meeting: MeetingDetailRecord) {
  const summary = normalizeMarkdownSection(
    getArtifact(meeting, "meeting_summary")?.contentMd ?? "",
    "_Саммари отсутствует._"
  )
  const protocol = normalizeMarkdownSection(
    getArtifact(meeting, "meeting_protocol")?.contentMd ?? "",
    "_Протокол отсутствует._"
  )
  const actionItems = getActionsItems(meeting)
  const actions = actionItems.length
    ? actionItems.map(formatActionItem).join("\n")
    : normalizeMarkdownSection(
        getArtifact(meeting, "meeting_actions")?.contentMd ?? "",
        "_Поручения отсутствуют._"
      )

  return [
    `# ${meeting.title}`,
    meeting.description ? meeting.description : "",
    "",
    "## Саммари",
    summary,
    "",
    "## Протокол",
    protocol,
    "",
    "## Поручения",
    actions,
  ]
    .filter(Boolean)
    .join("\n")
}

function buildMeetingInfoUrl(meetingId: string, currentPage: number) {
  return `/meetings?page=${currentPage}&meeting=${meetingId}&info=1`
}

function MeetingInfoSheet({
  meeting,
  open,
  onOpenChange,
}: {
  meeting: MeetingDetailRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (!meeting) {
    return null
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-[980px]">
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle>Информация о встрече</SheetTitle>
          <SheetDescription>
            Технические детали, артефакты и история обработки.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-6 p-6">
            <Card>
              <CardHeader className="border-b">
                <CardTitle className="truncate">{meeting.title}</CardTitle>
                <CardDescription>
                  {meeting.description || "Описание не заполнено."}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border p-4">
                  <div className="text-sm text-muted-foreground">Статус</div>
                  <div className="mt-2">
                    <StatusBadge status={meeting.status} />
                  </div>
                </div>
                <div className="rounded-2xl border p-4">
                  <div className="text-sm text-muted-foreground">Спикеров</div>
                  <div className="mt-2 text-2xl font-semibold">{meeting.speakersCount}</div>
                </div>
                <div className="rounded-2xl border p-4">
                  <div className="text-sm text-muted-foreground">Длительность</div>
                  <div className="mt-2 text-2xl font-semibold">
                    {formatDuration(meeting.durationSeconds)}
                  </div>
                </div>
                <div className="rounded-2xl border p-4">
                  <div className="text-sm text-muted-foreground">Источник</div>
                  <div className="mt-2 text-sm font-medium">
                    {sourceFileLabel(meeting)}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b">
                <CardTitle>Jobs</CardTitle>
                <CardDescription>Служебная история этапов обработки встречи.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Этап</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>Запуск</TableHead>
                      <TableHead>Завершение</TableHead>
                      <TableHead>Ошибка</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {meeting.jobs.map((job) => (
                      <TableRow key={job.id}>
                        <TableCell>{stageTitle(job.stage)}</TableCell>
                        <TableCell>
                          <StatusBadge status={job.status} />
                        </TableCell>
                        <TableCell>{formatDateTime(job.startedAt)}</TableCell>
                        <TableCell>{formatDateTime(job.finishedAt)}</TableCell>
                        <TableCell className="max-w-[360px] text-sm text-muted-foreground">
                          {job.errorText || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b">
                <CardTitle>Артефакты</CardTitle>
                <CardDescription>Промежуточные и итоговые материалы обработки.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 p-4">
                {meeting.artifacts.map((artifact) => (
                  <Card key={artifact.id} size="sm">
                    <CardHeader className="border-b">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <CardTitle>{stageTitle(artifact.stage)}</CardTitle>
                          <CardDescription>{artifact.format.toUpperCase()}</CardDescription>
                        </div>
                        <Badge variant="outline">{artifact.id}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-4">
                      <Textarea
                        readOnly
                        value={artifact.contentMd || JSON.stringify(artifact.contentJson, null, 2)}
                        className="min-h-[220px] font-mono text-xs leading-6"
                      />
                    </CardContent>
                  </Card>
                ))}
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}

function markdownComponents() {
  return {
    h1: ({ children }: { children?: React.ReactNode }) => (
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">{children}</h1>
    ),
    h2: ({ children }: { children?: React.ReactNode }) => (
      <h2 className="mt-6 mb-3 text-lg font-semibold tracking-tight">{children}</h2>
    ),
    h3: ({ children }: { children?: React.ReactNode }) => (
      <h3 className="mt-4 mb-2 text-base font-medium">{children}</h3>
    ),
    p: ({ children }: { children?: React.ReactNode }) => (
      <p className="mb-3 leading-7 text-foreground">{children}</p>
    ),
    li: ({ children }: { children?: React.ReactNode }) => (
      <li className="mb-1 leading-7">{children}</li>
    ),
    ul: ({ children }: { children?: React.ReactNode }) => (
      <ul className="mb-3 list-disc pl-5">{children}</ul>
    ),
    ol: ({ children }: { children?: React.ReactNode }) => (
      <ol className="mb-3 list-decimal pl-5">{children}</ol>
    ),
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote className="border-l-2 border-border pl-4 text-muted-foreground">
        {children}
      </blockquote>
    ),
    code: ({
      inline,
      children,
    }: {
      inline?: boolean
      children?: React.ReactNode
    }) =>
      inline ? (
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">
          {children}
        </code>
      ) : (
        <code className="block whitespace-pre-wrap rounded-lg bg-muted p-3 font-mono text-xs leading-6">
          {children}
        </code>
      ),
    pre: ({ children }: { children?: React.ReactNode }) => (
      <pre className="mb-4 overflow-x-auto rounded-lg bg-muted p-3">{children}</pre>
    ),
  }
}

function StatusBadge({
  status,
}: {
  status: MeetingStatus | MeetingJobRecord["status"]
}) {
  if (
    status === "queued" ||
    status === "processing" ||
    status === "done" ||
    status === "failed"
  ) {
    return <Badge variant={jobStatusVariant(status)}>{jobStatusLabel(status)}</Badge>
  }

  return <Badge variant={meetingStatusVariant(status)}>{meetingStatusLabel(status)}</Badge>
}

function EmptyState({
  title,
  description,
  icon: Icon,
}: {
  title: string
  description: string
  icon: typeof FileTextIcon
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <Icon className="text-muted-foreground" />
        <div className="space-y-1">
          <div className="text-base font-medium">{title}</div>
          <div className="max-w-md text-sm text-muted-foreground">{description}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function MeetingsWorkspaceView({
  currentPage,
  pageData,
  selectedMeetingId,
  selectedMeeting,
  showInfoSheet,
}: {
  currentPage: number
  pageData: PaginatedMeetings
  selectedMeetingId: string | null
  selectedMeeting: MeetingDetailRecord | null
  showInfoSheet: boolean
}) {
  const router = useRouter()
  const stats = useMemo(() => {
    const items = pageData.items
    const completed = items.filter((item) => item.status === "completed").length
    const processing = items.filter((item) => item.status === "processing").length
    const failed = items.filter((item) => item.status === "failed").length
    return { completed, processing, failed, total: pageData.total }
  }, [pageData])

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.10),_transparent_32%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.10),_transparent_28%),linear-gradient(to_bottom,_var(--background),_var(--background))]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" nativeButton={false} render={<Link href="/" />}>
            <ArrowLeftIcon data-icon="inline-start" />
            К интерфейсу LMS
          </Button>
        </div>

        <section className="overflow-hidden rounded-3xl border bg-card/80 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-6 p-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <Badge variant="secondary" className="mb-3">
                <WandSparklesIcon data-icon="inline-start" />
                Модуль встреч
              </Badge>
              <h1 className="text-3xl font-semibold tracking-tight">
                Встречи, транскрипты и ручная правка спикеров
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
                Загруженные встречи, diarized transcript, единый markdown-результат и
                история обработки в одном месте.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[420px]">
              <Card size="sm">
                <CardHeader className="pb-2">
                  <CardDescription>Всего</CardDescription>
                  <CardTitle>{stats.total}</CardTitle>
                </CardHeader>
              </Card>
              <Card size="sm">
                <CardHeader className="pb-2">
                  <CardDescription>Готовы</CardDescription>
                  <CardTitle>{stats.completed}</CardTitle>
                </CardHeader>
              </Card>
              <Card size="sm">
                <CardHeader className="pb-2">
                  <CardDescription>В работе</CardDescription>
                  <CardTitle>{stats.processing}</CardTitle>
                </CardHeader>
              </Card>
              <Card size="sm">
                <CardHeader className="pb-2">
                  <CardDescription>Ошибки</CardDescription>
                  <CardTitle>{stats.failed}</CardTitle>
                </CardHeader>
              </Card>
            </div>
          </div>
        </section>

        <section className="grid flex-1 gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
          <Card className="flex min-h-[760px] flex-col overflow-hidden border-border/80 bg-card">
            <CardHeader className="border-b bg-secondary/35">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>Список встреч</CardTitle>
                  <CardDescription>
                    Выберите встречу слева, а справа откроются результаты обработки.
                  </CardDescription>
                </div>
                <Badge variant="outline">{pageData.total}</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col p-0">
              <ScrollArea className="min-h-0 flex-1">
                {pageData.items.length > 0 ? (
                  <div className="space-y-3 p-3">
                    {pageData.items.map((meeting) => {
                      const isSelected = meeting.id === selectedMeetingId
                      return (
                        <div
                          key={meeting.id}
                          className={cn(
                            "rounded-2xl border p-4 transition-colors hover:bg-muted/35",
                            isSelected
                              ? "border-primary/40 bg-muted/40 shadow-sm"
                              : "border-border/70 bg-card"
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <Link
                              href={`/meetings?page=${currentPage}&meeting=${meeting.id}`}
                              className="min-w-0 flex-1 space-y-2 text-left"
                            >
                              <div className="truncate text-base font-semibold">
                                {meeting.title}
                              </div>
                              <div className="line-clamp-2 text-sm text-muted-foreground">
                                {meeting.description || "Описание не заполнено"}
                              </div>
                            </Link>
                            <div className="flex items-start gap-2">
                              <StatusBadge status={meeting.status} />
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  className={cn(
                                    "inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/70 bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                  )}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <span className="sr-only">Действия встречи</span>
                                  <MoreHorizontalIcon className="size-4" />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="min-w-56">
                                  <DropdownMenuItem
                                    onClick={() =>
                                      router.push(buildMeetingInfoUrl(meeting.id, currentPage))
                                    }
                                    className="items-start gap-3 py-2"
                                  >
                                    <InfoIcon className="mt-0.5 size-4" />
                                    <div className="space-y-0.5">
                                      <div className="font-medium">Информация</div>
                                      <div className="text-xs text-muted-foreground">
                                        Открыть технические детали и историю обработки.
                                      </div>
                                    </div>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onClick={() => {
                                      const confirmed = window.confirm(
                                        "Удалить встречу и все связанные материалы?"
                                      )
                                      if (!confirmed) {
                                        return
                                      }

                                      void (async () => {
                                        await deleteMeeting(meeting.id)
                                        const nextMeetingId =
                                          selectedMeetingId === meeting.id
                                            ? pageData.items.find(
                                                (item) => item.id !== meeting.id
                                              )?.id ?? null
                                            : selectedMeetingId
                                        const nextUrl = `/meetings?page=${currentPage}${
                                          nextMeetingId ? `&meeting=${nextMeetingId}` : ""
                                        }`
                                        router.replace(nextUrl)
                                        router.refresh()
                                      })()
                                    }}
                                    className="items-start gap-3 py-2"
                                  >
                                    <Trash2Icon className="mt-0.5 size-4" />
                                    <div className="space-y-0.5">
                                      <div className="font-medium">Удалить</div>
                                      <div className="text-xs text-muted-foreground">
                                        Удалить встречу и все её материалы.
                                      </div>
                                    </div>
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Badge variant="outline">{meeting.speakersCount} спик.</Badge>
                            <Badge variant="outline">
                              {formatDuration(meeting.durationSeconds)}
                            </Badge>
                          </div>
                          <div className="mt-3 text-xs text-muted-foreground">
                            {formatDateTime(meeting.updatedAt)}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="p-4">
                    <EmptyState
                      icon={VideoIcon}
                      title="Пока нет встреч"
                      description="Когда появятся загруженные файлы встреч, они будут показаны здесь."
                    />
                  </div>
                )}
              </ScrollArea>
              <Separator />
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="text-sm text-muted-foreground">
                  Показаны {pageData.total === 0 ? 0 : (currentPage - 1) * pageData.limit + 1}-
                  {Math.min(currentPage * pageData.limit, pageData.total)} из {pageData.total}
                </div>
                <Pagination className="mx-0 w-auto justify-end">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href={`/meetings?page=${Math.max(1, currentPage - 1)}${
                          selectedMeetingId ? `&meeting=${selectedMeetingId}` : ""
                        }`}
                        aria-disabled={currentPage <= 1}
                      />
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationLink href={`/meetings?page=${currentPage}`} isActive>
                        {currentPage} / {pageData.totalPages}
                      </PaginationLink>
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext
                        href={`/meetings?page=${Math.min(pageData.totalPages, currentPage + 1)}${
                          selectedMeetingId ? `&meeting=${selectedMeetingId}` : ""
                        }`}
                        aria-disabled={currentPage >= pageData.totalPages}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            </CardContent>
          </Card>

          <Card className="flex min-h-[760px] flex-col overflow-hidden border-border/80 bg-card">
            <CardHeader className="border-b bg-secondary/20">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>Результаты обработки</CardTitle>
                  <CardDescription>
                    Транскрипт, markdown и правка speaker labels для выбранной встречи.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 p-0">
              {selectedMeeting ? (
                <ScrollArea className="h-[760px]">
                  <MeetingDetailView
                    meetingId={selectedMeeting.id}
                    initialMeeting={selectedMeeting}
                    embedded
                  />
                </ScrollArea>
              ) : (
                <div className="flex h-full min-h-[680px] items-center justify-center p-8 text-center">
                <div className="max-w-md space-y-2">
                  <h2 className="text-xl font-semibold">Выберите встречу</h2>
                  <p className="text-sm text-muted-foreground">
                    Слева доступен список встреч. После выбора здесь откроются транскрипт,
                    markdown и история обработки.
                  </p>
                </div>
              </div>
            )}
            </CardContent>
          </Card>
        </section>
      </div>
      <MeetingInfoSheet
        meeting={selectedMeeting}
        open={showInfoSheet && Boolean(selectedMeeting)}
        onOpenChange={(open) => {
          if (open) {
            return
          }

          const params = new URLSearchParams({
            page: String(currentPage),
          })
          if (selectedMeetingId) {
            params.set("meeting", selectedMeetingId)
          }
          router.replace(`/meetings?${params.toString()}`)
          router.refresh()
        }}
      />
    </div>
  )
}

export function MeetingDetailView({
  meetingId,
  initialMeeting,
  embedded = false,
}: {
  meetingId: string
  initialMeeting: MeetingDetailRecord
  embedded?: boolean
}) {
  const [activeTab, setActiveTab] = useState("markdown")
  const [speakerDrafts, setSpeakerDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initialMeeting.speakers.map((speaker) => [speaker.id, speaker.displayName])
    )
  )
  const [speakerOverrides, setSpeakerOverrides] = useState<Record<string, string>>({})
  const [savingSpeakerId, setSavingSpeakerId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const meeting = useMemo(() => {
    const speakerNames = new Map(
      initialMeeting.speakers.map((speaker) => [
        speaker.id,
        speakerOverrides[speaker.id] ?? speaker.displayName,
      ])
    )

    return {
      ...initialMeeting,
      speakers: initialMeeting.speakers.map((speaker) => ({
        ...speaker,
        displayName: speakerNames.get(speaker.id) ?? speaker.displayName,
      })),
      segments: initialMeeting.segments.map((segment) => ({
        ...segment,
        displayName:
          segment.speakerId != null
            ? speakerNames.get(segment.speakerId) ?? segment.displayName
            : segment.displayName,
      })),
    }
  }, [initialMeeting, speakerOverrides])

  const combinedMarkdown = useMemo(() => buildReadableMarkdown(meeting), [meeting])

  const handleSaveSpeaker = async (speaker: MeetingSpeakerRecord) => {
    const draft = speakerDrafts[speaker.id]?.trim()
    if (!draft || draft === speaker.displayName) {
      return
    }

    setSavingSpeakerId(speaker.id)
    setError(null)
    try {
      const updated = await updateMeetingSpeaker(meetingId, speaker.id, draft)
      setSpeakerOverrides((current) => ({
        ...current,
        [updated.id]: updated.displayName,
      }))
      setSpeakerDrafts((current) => ({
        ...current,
        [updated.id]: updated.displayName,
      }))
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Не удалось сохранить спикера"
      )
    } finally {
      setSavingSpeakerId(null)
    }
  }

  const handleCopyMarkdown = async () => {
    await navigator.clipboard.writeText(combinedMarkdown)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const handleDownloadMarkdown = () => {
    downloadText(`${meeting.title}.md`, combinedMarkdown)
  }

  const handleRefresh = () => {
    window.location.reload()
  }

  return (
    <div
      className={
        embedded
          ? "h-full min-h-0 bg-transparent"
          : "min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.10),_transparent_32%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.10),_transparent_28%),linear-gradient(to_bottom,_var(--background),_var(--background))]"
      }
    >
      <div
        className={
          embedded
            ? "flex min-h-0 flex-col gap-4 p-4"
            : "mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8"
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          {embedded ? null : (
            <Button variant="ghost" nativeButton={false} render={<Link href="/meetings" />}>
              <ArrowLeftIcon data-icon="inline-start" />
              К списку
            </Button>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={handleRefresh}>
              <RefreshCwIcon data-icon="inline-start" />
              Обновить
            </Button>
            <Button variant="outline" onClick={handleCopyMarkdown}>
              <CopyIcon data-icon="inline-start" />
              {copied ? "Скопировано" : "Копировать markdown"}
            </Button>
            <Button onClick={handleDownloadMarkdown}>
              <DownloadIcon data-icon="inline-start" />
              Скачать markdown
            </Button>
          </div>
        </div>

        {error ? (
          <Alert variant="destructive">
            <XCircleIcon />
            <AlertTitle>Не удалось сохранить спикера</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-col gap-4">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="markdown">
              <SparklesIcon data-icon="inline-start" />
              Markdown
            </TabsTrigger>
            <TabsTrigger value="transcript">
              <FileTextIcon data-icon="inline-start" />
              Транскрипт
            </TabsTrigger>
            <TabsTrigger value="speakers">
              <SquarePenIcon data-icon="inline-start" />
              Спикеры
            </TabsTrigger>
          </TabsList>

          <TabsContent value="markdown" className="space-y-4">
            <Card>
              <CardHeader className="border-b">
                <CardTitle>Человекочитаемый markdown</CardTitle>
                <CardDescription>
                  На этой вкладке собраны саммари, протокол и поручения без технических деталей.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 p-4">
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={handleCopyMarkdown}>
                    <CopyIcon data-icon="inline-start" />
                    {copied ? "Скопировано" : "Копировать"}
                  </Button>
                  <Button onClick={handleDownloadMarkdown}>
                    <DownloadIcon data-icon="inline-start" />
                    Скачать .md
                  </Button>
                </div>
                <Textarea
                  readOnly
                  value={combinedMarkdown}
                  className="min-h-[420px] font-mono text-xs leading-6"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b">
                <CardTitle>Предпросмотр</CardTitle>
                <CardDescription>Отрисовка markdown без потери структуры.</CardDescription>
              </CardHeader>
              <CardContent className="p-4">
                <ScrollArea className="h-[520px] rounded-xl border bg-background p-4">
                  <div className="max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents()}>
                      {combinedMarkdown}
                    </ReactMarkdown>
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="transcript" className="space-y-4">
            <Card>
              <CardHeader className="border-b">
                <CardTitle>Diarized transcript</CardTitle>
                <CardDescription>
                  Только диаризованный текст, который можно читать и править через
                  speaker labels.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[680px]">
                  <div className="flex flex-col gap-3 p-4">
                    {meeting.segments.length > 0 ? (
                      meeting.segments.map((segment) => (
                        <div
                          key={segment.id}
                          className="rounded-2xl border bg-card p-4 shadow-sm"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">
                              {segment.displayName || segment.speakerLabel}
                            </Badge>
                            <Badge variant="secondary">
                              {Math.floor(segment.startMs / 1000)}s -{" "}
                              {Math.floor(segment.endMs / 1000)}s
                            </Badge>
                            {segment.confidence != null ? (
                              <Badge variant="outline">
                                confidence {segment.confidence.toFixed(2)}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-3 whitespace-pre-wrap leading-7">
                            {segment.text || "—"}
                          </p>
                        </div>
                      ))
                    ) : (
                      <EmptyState
                        icon={FileTextIcon}
                        title="Транскрипт пока пуст"
                        description="Когда SaluteSpeech вернёт diarized segments, они появятся здесь."
                      />
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="speakers" className="space-y-4">
            <Card>
              <CardHeader className="border-b">
                <CardTitle>Ручная правка speaker labels</CardTitle>
                <CardDescription>
                  Можно переименовать любой label в понятное пользователю имя.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Label</TableHead>
                      <TableHead>Отображаемое имя</TableHead>
                      <TableHead>Состояние</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {meeting.speakers.map((speaker) => (
                      <TableRow key={speaker.id}>
                        <TableCell className="font-mono text-xs">
                          {speaker.speakerLabel}
                        </TableCell>
                        <TableCell>
                          <div className="grid gap-2">
                            <Label htmlFor={`speaker-${speaker.id}`} className="sr-only">
                              Имя спикера
                            </Label>
                            <Input
                              id={`speaker-${speaker.id}`}
                              value={speakerDrafts[speaker.id] ?? speaker.displayName}
                              onChange={(event) =>
                                setSpeakerDrafts((current) => ({
                                  ...current,
                                  [speaker.id]: event.target.value,
                                }))
                              }
                            />
                          </div>
                        </TableCell>
                        <TableCell>
                          {speakerOverrides[speaker.id] ? (
                            <Badge variant="secondary">Изменён вручную</Badge>
                          ) : (
                            <Badge variant="outline">Авто</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            onClick={() => void handleSaveSpeaker(speaker)}
                            disabled={savingSpeakerId === speaker.id}
                          >
                            {savingSpeakerId === speaker.id ? (
                              <Loader2Icon data-icon="inline-start" className="animate-spin" />
                            ) : (
                              <SaveIcon data-icon="inline-start" />
                            )}
                            Сохранить
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
