"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIcon,
  AlertCircleIcon,
  ArrowLeftIcon,
  CheckCircle2Icon,
  CopyIcon,
  DatabaseIcon,
  DownloadIcon,
  FileTextIcon,
  MicIcon,
  PlusIcon,
  Loader2Icon,
  InfoIcon,
  SaveIcon,
  ServerCogIcon,
  SparklesIcon,
  SquarePenIcon,
  MoreHorizontalIcon,
  VideoIcon,
  UploadIcon,
  WandSparklesIcon,
  Trash2Icon,
  XCircleIcon,
  XIcon,
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
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress"
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
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import {
  meetingStageLabels,
  type MeetingArtifactRecord,
  type MeetingDetailRecord,
  type MeetingJobRecord,
  type MeetingListRecord,
  type MeetingStageId,
  type MeetingStatus,
  type PaginatedMeetings,
  type ServiceHealthState,
  type ServiceHealthStatus,
  type SystemHealthRecord,
  abortMeetingUpload,
  completeMeetingUpload,
  createMeeting,
  deleteMeeting,
  generateMeetingStage,
  getSystemHealth,
  getMeeting,
  initMeetingUpload,
  listMeetings,
  signMeetingUploadPart,
  startMeeting,
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

function formatErrorText(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
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
  description?: string
  assignee?: string
  deadline?: string
  sourceSegmentIds?: number[]
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
  const text =
    item.title?.trim() || item.text?.trim() || item.description?.trim() || "Поручение"
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

function isMeetingActiveStatus(status: MeetingStatus) {
  return status === "uploaded" || status === "processing"
}

function isActiveJobStatus(status: MeetingJobRecord["status"]) {
  return status === "queued" || status === "processing"
}

function toTime(value: string | null | undefined) {
  if (!value) {
    return 0
  }
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

function getStageOutputUpdatedAt(
  meeting: MeetingDetailRecord,
  stage: MeetingStageId
) {
  if (stage === "audio_prepared") {
    return meeting.sourceFile?.processingStatus === "done"
      ? toTime(meeting.sourceFile.createdAt)
      : 0
  }

  if (stage === "transcript_compiled" && meeting.segments.length > 0) {
    return Math.max(
      ...meeting.segments.map((segment) => toTime(segment.createdAt)),
      toTime(getArtifact(meeting, "transcript_compiled")?.updatedAt)
    )
  }

  if (stage === "meeting_actions" && getActionsItems(meeting).length > 0) {
    return toTime(getArtifact(meeting, "meeting_actions")?.updatedAt)
  }

  const artifact = getArtifact(meeting, stage)
  return artifact?.contentMd?.trim() ? toTime(artifact.updatedAt) : 0
}

function hasStageOutput(meeting: MeetingDetailRecord, stage: MeetingStageId) {
  if (stage === "audio_prepared") {
    return meeting.sourceFile?.processingStatus === "done"
  }
  if (stage === "transcript_compiled") {
    return meeting.segments.length > 0 || Boolean(getArtifact(meeting, stage)?.contentMd?.trim())
  }
  if (stage === "meeting_actions") {
    return (
      getActionsItems(meeting).length > 0 ||
      Boolean(getArtifact(meeting, stage)?.contentMd?.trim())
    )
  }
  return Boolean(getArtifact(meeting, stage)?.contentMd?.trim())
}

function getStageJob(
  meeting: MeetingDetailRecord | null,
  stage: MeetingStageId
): MeetingJobRecord | undefined {
  if (!meeting) {
    return undefined
  }

  return [...meeting.jobs]
    .filter((job) => job.stage === stage)
    .sort((left, right) => {
      const leftTime = new Date(left.createdAt).getTime()
      const rightTime = new Date(right.createdAt).getTime()
      return rightTime - leftTime
    })[0]
}

type MeetingStageUiStatus = "done" | "processing" | "queued" | "failed" | "pending"

function getMeetingStageUiStatus(
  meeting: MeetingDetailRecord | null,
  stage: MeetingStageId
): MeetingStageUiStatus {
  if (!meeting) {
    return "pending"
  }

  const job = getStageJob(meeting, stage)
  const outputUpdatedAt = getStageOutputUpdatedAt(meeting, stage)

  if (
    job?.status === "processing" &&
    toTime(job.createdAt) > outputUpdatedAt
  ) {
    return "processing"
  }

  if (job?.status === "queued" && !hasStageOutput(meeting, stage)) {
    return "queued"
  }

  if (hasStageOutput(meeting, stage)) {
    return "done"
  }

  if (!job) {
    return "pending"
  }

  if (job.status === "done") {
    return "done"
  }
  if (job.status === "processing") {
    return "processing"
  }
  if (job.status === "queued") {
    return "queued"
  }
  if (job.status === "failed") {
    return "failed"
  }

  return "pending"
}

function hasEffectiveActiveMeetingJob(meeting: MeetingDetailRecord) {
  return ([
    "audio_prepared",
    "transcript_compiled",
    "meeting_summary",
    "meeting_protocol",
    "meeting_actions",
  ] as MeetingStageId[]).some((stage) => {
    const status = getMeetingStageUiStatus(meeting, stage)
    return status === "queued" || status === "processing"
  })
}

function getMeetingProcessingProgress(meeting: MeetingDetailRecord | null) {
  if (!meeting) {
    return 0
  }

  const statuses = (
    [
      "audio_prepared",
      "transcript_compiled",
      "meeting_summary",
      "meeting_protocol",
      "meeting_actions",
    ] as MeetingStageId[]
  ).map((stage) => getMeetingStageUiStatus(meeting, stage))

  const doneCount = statuses.filter((status) => status === "done").length
  const processingCount = statuses.filter((status) => status === "processing").length
  const queuedCount = statuses.filter((status) => status === "queued").length

  const total = statuses.length || 1
  const weighted = doneCount + processingCount * 0.6 + queuedCount * 0.2

  return Math.round((weighted / total) * 100)
}

function getStageStatusLabel(status: MeetingStageUiStatus) {
  switch (status) {
    case "done":
      return "Готово"
    case "processing":
      return "В работе"
    case "queued":
      return "В очереди"
    case "failed":
      return "Ошибка"
    default:
      return "Ожидание"
  }
}

function getStageStatusTone(status: MeetingStageUiStatus) {
  switch (status) {
    case "done":
      return "border-emerald-200 bg-emerald-50 text-emerald-700"
    case "processing":
      return "border-emerald-200 bg-emerald-50 text-emerald-700"
    case "queued":
      return "border-amber-200 bg-amber-50 text-amber-700"
    case "failed":
      return "border-red-200 bg-red-50 text-red-700"
    default:
      return "border-border bg-muted/40 text-muted-foreground"
  }
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

function formatTranscriptRange(startMs: number, endMs: number) {
  const formatOne = (value: number) => {
    const totalSeconds = Math.max(0, Math.floor(value / 1000))
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    if (hours > 0) {
      return `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    }

    return `${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`
  }

  return `${formatOne(startMs)} - ${formatOne(endMs)}`
}

function safeDownloadName(value: string) {
  return (
    value
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .slice(0, 120) || "meeting"
  )
}

function buildTranscriptMarkdown(meeting: MeetingDetailRecord) {
  const lines = [
    `# Транскрипт встречи: ${meeting.title}`,
    "",
    "## Метаданные",
    "",
    `- Встреча: ${meeting.title}`,
    meeting.description ? `- Комментарий: ${meeting.description}` : "",
    `- Статус: ${meetingStatusLabel(meeting.status)}`,
    `- Язык: ${meeting.language}`,
    `- Длительность: ${formatDuration(meeting.durationSeconds)}`,
    `- Спикеров: ${meeting.speakers.length || meeting.speakersCount}`,
    `- Создано: ${formatDateTime(meeting.createdAt)}`,
    meeting.processingFinishedAt
      ? `- Обработка завершена: ${formatDateTime(meeting.processingFinishedAt)}`
      : "",
    "",
    "## Спикеры",
    "",
    ...(
      meeting.speakers.length
        ? meeting.speakers.map(
            (speaker) => `- ${speaker.displayName} (${speaker.speakerLabel})`
          )
        : ["_Спикеры не определены._"]
    ),
    "",
    "## Полный транскрипт",
    "",
  ].filter(Boolean)

  if (meeting.segments.length === 0) {
    lines.push("_Транскрипт пока пуст._")
  } else {
    for (const segment of meeting.segments) {
      lines.push(
        `### [${formatTranscriptRange(segment.startMs, segment.endMs)}] ${
          segment.displayName || segment.speakerLabel
        }`,
        "",
        segment.text?.trim() || "—",
        ""
      )
    }
  }

  return `${lines.join("\n").trim()}\n`
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
      <SheetContent side="right" className="sm:max-w-[1040px]">
        <SheetHeader className="border-b border-border/70 bg-muted/20 px-6 py-5">
          <SheetTitle>Информация о встрече</SheetTitle>
          <SheetDescription>
            Технические детали, артефакты и история обработки.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-6 p-6">
            <Card>
              <CardHeader className="border-b border-border/70 bg-muted/20">
                <CardTitle className="truncate">{meeting.title}</CardTitle>
                <CardDescription>
                  {meeting.description || "Описание не заполнено."}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border p-4">
                  <div className="text-sm text-muted-foreground">Статус</div>
                  <div className="mt-2">
                    <StatusBadge
                      status={meeting.status}
                      errorText={meeting.errorText}
                      errorTitle="Ошибка обработки встречи"
                    />
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
              <CardHeader className="border-b border-border/70 bg-muted/20">
                <CardTitle>Этапы обработки</CardTitle>
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
                          <StatusBadge
                            status={job.status}
                            errorText={job.errorText}
                            errorTitle={`Ошибка этапа «${stageTitle(job.stage)}»`}
                          />
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
              <CardHeader className="border-b border-border/70 bg-muted/20">
                <CardTitle>Артефакты</CardTitle>
                <CardDescription>Промежуточные и итоговые материалы обработки.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 p-4">
                {meeting.artifacts.map((artifact) => (
                  <Card key={artifact.id} size="sm">
                    <CardHeader className="border-b border-border/70 bg-muted/20">
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
  errorText,
  errorTitle,
}: {
  status: MeetingStatus | MeetingJobRecord["status"]
  errorText?: string | null
  errorTitle?: string | null
}) {
  const errorDetails = formatErrorText(errorText)
  const badge =
    status === "queued" ||
    status === "processing" ||
    status === "done" ||
    status === "failed" ? (
      <Badge variant={jobStatusVariant(status)}>{jobStatusLabel(status)}</Badge>
    ) : (
      <Badge variant={meetingStatusVariant(status)}>{meetingStatusLabel(status)}</Badge>
    )

  if (status !== "failed" || !errorDetails) {
    return badge
  }

  return (
    <HoverCard>
      <HoverCardTrigger>
        <span className="inline-flex">{badge}</span>
      </HoverCardTrigger>
      <HoverCardContent align="start" side="top" className="max-w-96 space-y-2">
        <div className="space-y-1">
          <div className="text-sm font-medium">
            {errorTitle?.trim() || "Подробности ошибки"}
          </div>
          <div className="text-sm leading-6 text-muted-foreground">
            {errorDetails}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
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

function MeetingProcessingState({
  meeting,
}: {
  meeting: MeetingDetailRecord
}) {
  const stages: MeetingStageId[] = [
    "audio_prepared",
    "transcript_compiled",
    "meeting_summary",
    "meeting_protocol",
    "meeting_actions",
  ]
  const progress = getMeetingProcessingProgress(meeting)

  return (
    <Card className="border-dashed border-border/70 bg-card/95 shadow-sm">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-sm font-semibold tracking-tight">Обработка встречи выполняется</div>
            <div className="text-sm leading-6 text-muted-foreground">
              Статусы обновляются автоматически, страницу обновлять не нужно.
            </div>
          </div>
          <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">
            {progress}%
          </Badge>
        </div>
        <Progress value={progress} />
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          {stages.map((stage) => {
            const status = getMeetingStageUiStatus(meeting, stage)
            return (
              <div
                key={stage}
                className={cn(
                  "rounded-xl border px-3 py-2.5 shadow-sm",
                  getStageStatusTone(status),
                  status === "processing" ? "animate-pulse" : ""
                )}
              >
                <div className="text-xs font-semibold">{stageTitle(stage)}</div>
                <div className="mt-1 text-xs opacity-90">{getStageStatusLabel(status)}</div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function MarkdownLoadingState() {
  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-background/80 p-4 shadow-sm">
      <Skeleton className="h-8 w-2/5" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-10/12" />
      <Skeleton className="h-4 w-9/12" />
    </div>
  )
}

function TranscriptLoadingState() {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="rounded-xl border border-border/70 bg-card/95 px-3 py-3 shadow-sm">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-20" />
          </div>
          <div className="mt-3 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  )
}

function MeetingCardProgress({
  meeting,
}: {
  meeting: MeetingListRecord | MeetingDetailRecord
}) {
  const currentStatus = meeting.status

  if (currentStatus !== "processing" && currentStatus !== "uploaded" && currentStatus !== "failed") {
    return null
  }

  const progress =
    "jobs" in meeting
      ? getMeetingProcessingProgress(meeting)
      : currentStatus === "failed"
        ? 100
        : currentStatus === "processing"
          ? 45
          : 15

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          {currentStatus === "failed" ? "Обработка остановлена" : "Идёт обработка"}
        </span>
        <span>{progress}%</span>
      </div>
      <Progress value={progress} className="h-1.5" />
    </div>
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

const MEETING_FILE_ACCEPT =
  "audio/*,video/*,.webm,.mp4,.mov,.m4a,.mp3,.wav,.ogg,.opus"
const DEFAULT_MEETING_PART_SIZE_BYTES = 5 * 1024 * 1024

type UiAlertType = "success" | "error" | "info"

type UiAlert = {
  id: string
  type: UiAlertType
  title: string
  description?: string
}

function meetingTitleFromFile(file: File) {
  return file.name.replace(/\.[^.]+$/, "").trim()
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
  const meetingFileInputRef = useRef<HTMLInputElement | null>(null)
  const [alerts, setAlerts] = useState<UiAlert[]>([])
  const [systemHealth, setSystemHealth] = useState<SystemHealthRecord | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [meetingTitle, setMeetingTitle] = useState("")
  const [meetingDescription, setMeetingDescription] = useState("")
  const [meetingFile, setMeetingFile] = useState<File | null>(null)
  const [createDropActive, setCreateDropActive] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createPhase, setCreatePhase] = useState<"idle" | "uploading" | "done" | "error">("idle")
  const [createMessage, setCreateMessage] = useState("")
  const [createProgress, setCreateProgress] = useState(0)
  const [isCreating, setIsCreating] = useState(false)
  const [meetingsPageState, setMeetingsPageState] = useState(pageData)
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(
    selectedMeetingId ?? pageData.items[0]?.id ?? null
  )
  const [selectedMeetingState, setSelectedMeetingState] = useState(selectedMeeting)
  const [hasInitializedDefaultSelection, setHasInitializedDefaultSelection] = useState(
    Boolean(selectedMeetingId)
  )

  useEffect(() => {
    setMeetingsPageState(pageData)
  }, [pageData])

  useEffect(() => {
    if (selectedMeeting) {
      setSelectedMeetingState(selectedMeeting)
    }
  }, [selectedMeeting])

  useEffect(() => {
    if (selectedMeetingId) {
      setActiveMeetingId(selectedMeetingId)
    }
  }, [selectedMeetingId])

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

  async function refreshHealth() {
    try {
      const health = await getSystemHealth()
      setSystemHealth(health)
      return health
    } catch {
      setSystemHealth(null)
      return null
    }
  }

  useEffect(() => {
    let cancelled = false

    const loadHealth = async () => {
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

    void loadHealth()
    const intervalId = window.setInterval(() => {
      void loadHealth()
    }, 15_000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function refreshMeetingsState() {
      try {
        const nextPage = await listMeetings(currentPage, pageData.limit)
        if (cancelled) {
          return
        }
        setMeetingsPageState(nextPage)

        if (activeMeetingId) {
          const nextMeeting = await getMeeting(activeMeetingId)
          if (!cancelled) {
            setSelectedMeetingState(nextMeeting)
          }
        } else if (!cancelled) {
          setSelectedMeetingState(null)
        }
      } catch {
        // keep current state; next tick will retry quietly
      }
    }

    const hasActiveListMeeting = meetingsPageState.items.some((meeting) =>
      isMeetingActiveStatus(meeting.status)
    )
    const hasActiveSelectedMeeting =
      selectedMeetingState?.status === "uploaded" ||
      selectedMeetingState?.status === "processing" ||
      selectedMeetingState?.jobs.some((job) => isActiveJobStatus(job.status)) === true

    if (!hasActiveListMeeting && !hasActiveSelectedMeeting) {
      return
    }

    void refreshMeetingsState()

    const getIntervalMs = () => (document.hidden ? 15_000 : 5_000)
    let intervalId = window.setInterval(() => {
      void refreshMeetingsState()
    }, getIntervalMs())

    const handleVisibilityChange = () => {
      window.clearInterval(intervalId)
      intervalId = window.setInterval(() => {
        void refreshMeetingsState()
      }, getIntervalMs())
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.clearInterval(intervalId)
    }
  }, [
    currentPage,
    activeMeetingId,
    meetingsPageState.items,
    pageData.limit,
    selectedMeetingState,
  ])

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

  function getMeetingHealthBlockers(health: SystemHealthRecord | null) {
    if (!health) {
      return ["Не удалось проверить доступность сервисов."]
    }

    const blockers: string[] = []
    const requiredServices: Array<{
      name: string
      state: ServiceHealthState
      allowUnknown?: boolean
    }> = [
      { name: "API", state: health.services.api },
      { name: "Postgres", state: health.services.postgres },
      { name: "Redis", state: health.services.redis },
      { name: "Worker", state: health.services.worker, allowUnknown: true },
      { name: "LLM", state: health.services.llm, allowUnknown: true },
      {
        name: health.speechProviderName ?? "STT-провайдер",
        state: health.services.speechProvider,
        allowUnknown: true,
      },
    ]

    for (const service of requiredServices) {
      const shouldBlock =
        service.state.status === "down" ||
        service.state.status === "degraded" ||
        (!service.allowUnknown && service.state.status === "unknown")

      if (shouldBlock) {
        blockers.push(`${service.name}: ${service.state.details}`)
      }
    }

    return blockers
  }

  function resetCreateMeetingForm() {
    setMeetingTitle("")
    setMeetingDescription("")
    setMeetingFile(null)
    setCreateDropActive(false)
    setCreateError(null)
    setCreatePhase("idle")
    setCreateMessage("")
    setCreateProgress(0)
    setIsCreating(false)
  }

  function selectMeetingFile(file: File | null) {
    setCreateError(null)
    setMeetingFile(file)
    if (file && !meetingTitle.trim()) {
      setMeetingTitle(meetingTitleFromFile(file))
    }
  }

  function handleMeetingFileDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setCreateDropActive(false)
    selectMeetingFile(Array.from(event.dataTransfer.files ?? [])[0] ?? null)
  }

  async function uploadMeetingFile(meetingId: string, file: File) {
    const init = await initMeetingUpload(meetingId, {
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || "application/octet-stream",
    })

    const partSize = init.partSize || DEFAULT_MEETING_PART_SIZE_BYTES
    const totalParts = Math.max(1, Math.ceil(file.size / partSize))

    try {
      for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
        const start = (partNumber - 1) * partSize
        const end = Math.min(file.size, partNumber * partSize)
        const part = file.slice(start, end)
        const signed = await signMeetingUploadPart(init.uploadId, partNumber)
        setCreateMessage(`Загружается ${file.name}: часть ${partNumber}/${totalParts}`)
        const response = await fetch(signed.signedUrl, {
          method: signed.method || "PUT",
          headers: signed.headers,
          body: part,
        })

        if (!response.ok) {
          throw new Error(`Не удалось загрузить часть ${partNumber}`)
        }

        setCreateProgress(Math.round((partNumber / totalParts) * 100))
      }

      await completeMeetingUpload(init.uploadId)
    } catch (error) {
      await abortMeetingUpload(init.uploadId).catch(() => undefined)
      throw error
    }
  }

  const handleSelectMeeting = useCallback(
    async (meetingId: string) => {
      const meetingHref = `/meetings?page=${currentPage}&meeting=${meetingId}`
      setActiveMeetingId(meetingId)
      router.push(meetingHref)

      try {
        const nextMeeting = await getMeeting(meetingId)
        setSelectedMeetingState(nextMeeting)
      } catch {
        // keep optimistic active state; server props will catch up on next render
      }
    },
    [currentPage, router]
  )

  useEffect(() => {
    if (hasInitializedDefaultSelection) {
      return
    }

    const firstMeetingId = meetingsPageState.items[0]?.id ?? null
    if (!firstMeetingId) {
      return
    }

    setHasInitializedDefaultSelection(true)
    void handleSelectMeeting(firstMeetingId)
  }, [hasInitializedDefaultSelection, handleSelectMeeting, meetingsPageState.items])

  async function handleCreateMeeting() {
    const trimmedTitle = meetingTitle.trim()
    if (!trimmedTitle) {
      setCreateError("Укажите название встречи.")
      return
    }

    if (!meetingFile) {
      setCreateError("Добавьте файл записи встречи.")
      return
    }

    setIsCreating(true)
    setCreateError(null)
    setCreatePhase("uploading")
    setCreateProgress(0)

    try {
      const health = await refreshHealth()
      const blockers = getMeetingHealthBlockers(health)
      if (blockers.length > 0) {
        const message = blockers.join(" ")
        setCreatePhase("error")
        setCreateError(message)
        notify("error", "Обработка недоступна", message)
        return
      }

      setCreateMessage("Создаём карточку встречи")
      const created = await createMeeting({
        title: trimmedTitle,
        description: meetingDescription.trim(),
      })

      await uploadMeetingFile(created.id, meetingFile)
      setCreateMessage("Запускаем обработку")
      await startMeeting(created.id)
      setCreatePhase("done")
      setCreateMessage("Запись добавлена и отправлена в обработку")
      notify("success", "Запись добавлена", "Встреча создана и отправлена в обработку.")
      setCreateOpen(false)
      resetCreateMeetingForm()
      setSelectedMeetingState(null)
      router.push(`/meetings?page=1&meeting=${created.id}`)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Не удалось добавить запись встречи"
      setCreatePhase("error")
      setCreateError(message)
      notify("error", "Ошибка обработки встречи", message)
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="min-h-screen bg-transparent">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-border/70 bg-card/95 px-5 py-5 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/" />}>
                  <ArrowLeftIcon data-icon="inline-start" />
                  LMS
                </Button>
                <Badge variant="secondary">
                  <WandSparklesIcon data-icon="inline-start" />
                  Встречи
                </Badge>
              </div>
              <div className="space-y-2">
                <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  Встречи
                </h1>
                <p className="max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
                  Единое рабочее пространство для формирования, протоколов и поручений.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href="/prompts?module=meetings&from=meetings" />}
              >
                <SquarePenIcon data-icon="inline-start" />
                Промпты
              </Button>
              <HoverCard>
                <HoverCardTrigger
                  render={
                    <button
                      type="button"
                      className={cn(
                        "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm shadow-sm transition-colors",
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
                      Обновлено: {systemHealth ? formatDateTime(systemHealth.timestamp) : "нет данных"}
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
                            <div className="text-xs leading-5 text-muted-foreground">
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
            </div>
          </div>
        </div>

        <section className="grid flex-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          <Card className="flex min-h-[700px] flex-col overflow-hidden border-border/70 bg-card/95 shadow-sm">
            <CardHeader className="border-b border-border/70 bg-muted/35 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>Список встреч</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{meetingsPageState.total}</Badge>
                  <Button size="sm" onClick={() => setCreateOpen(true)}>
                    <PlusIcon data-icon="inline-start" />
                    Добавить
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col p-0">
              <ScrollArea className="min-h-0 flex-1">
                {meetingsPageState.items.length > 0 ? (
                  <div className="flex flex-col gap-2 p-2">
                    {meetingsPageState.items.map((meeting) => {
                      const isSelected = meeting.id === activeMeetingId
                      const meetingHref = `/meetings?page=${currentPage}&meeting=${meeting.id}`
                      return (
                        <div
                          key={meeting.id}
                          role="link"
                          tabIndex={0}
                          aria-label={`Открыть встречу ${meeting.title}`}
                          className={cn(
                            "cursor-pointer rounded-2xl border px-3 py-2.5 transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                            isSelected
                              ? "border-primary/30 bg-muted/40 shadow-sm"
                              : "border-border/70 bg-card/95"
                          )}
                          onClick={() => {
                            void handleSelectMeeting(meeting.id)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault()
                              void handleSelectMeeting(meeting.id)
                            }
                          }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <Link
                              href={meetingHref}
                              onClick={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                void handleSelectMeeting(meeting.id)
                              }}
                              className="min-w-0 flex-1 space-y-1 text-left"
                            >
                              <div className="truncate text-sm font-semibold">{meeting.title}</div>
                              <div className="line-clamp-1 text-xs text-muted-foreground">
                                {meeting.description || sourceFileLabel(meeting)}
                              </div>
                            </Link>
                            <div className="flex items-start gap-2">
                              <StatusBadge
                                status={meeting.status}
                                errorText={meeting.errorText}
                                errorTitle="Ошибка обработки встречи"
                              />
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  className={cn(
                                    "inline-flex size-7 items-center justify-center rounded-md border border-border/70 bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
                                            ? meetingsPageState.items.find(
                                                (item) => item.id !== meeting.id
                                              )?.id ?? null
                                            : selectedMeetingId
                                        const nextUrl = `/meetings?page=${currentPage}${
                                          nextMeetingId ? `&meeting=${nextMeetingId}` : ""
                                        }`
                                        setMeetingsPageState((current) => ({
                                          ...current,
                                          items: current.items.filter((item) => item.id !== meeting.id),
                                          total: Math.max(0, current.total - 1),
                                        }))
                                        if (selectedMeetingId === meeting.id) {
                                          setSelectedMeetingState(null)
                                        }
                                        router.replace(nextUrl)
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
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Badge variant="outline">
                              {formatDuration(meeting.durationSeconds)}
                            </Badge>
                            {meeting.speakersCount > 0 ? (
                              <Badge variant="outline">{meeting.speakersCount} спик.</Badge>
                            ) : null}
                            <div className="text-xs text-muted-foreground">
                              {formatDateTime(meeting.updatedAt)}
                            </div>
                          </div>
                          <MeetingCardProgress meeting={meeting} />
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
              <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="text-xs text-muted-foreground">
                  Показаны {meetingsPageState.total === 0 ? 0 : (currentPage - 1) * pageData.limit + 1}-
                  {Math.min(currentPage * pageData.limit, meetingsPageState.total)} из {meetingsPageState.total}
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
                        {currentPage} / {meetingsPageState.totalPages}
                      </PaginationLink>
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext
                        href={`/meetings?page=${Math.min(meetingsPageState.totalPages, currentPage + 1)}${
                          selectedMeetingId ? `&meeting=${selectedMeetingId}` : ""
                        }`}
                        aria-disabled={currentPage >= meetingsPageState.totalPages}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            </CardContent>
          </Card>

          <Card className="flex min-h-[700px] flex-col overflow-hidden border-border/70 bg-card/95 shadow-sm">
            <CardHeader className="border-b border-border/70 bg-muted/20 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>Результаты обработки</CardTitle>
                  <CardDescription>
                    Транскрипт, сводка, протокол и поручения в одном workspace.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 p-0">
              {selectedMeetingState ? (
                <ScrollArea className="h-[700px]">
                  <MeetingDetailView
                    meetingId={selectedMeetingState.id}
                    initialMeeting={selectedMeetingState}
                    embedded
                  />
                </ScrollArea>
              ) : (
                <div className="flex h-full min-h-[620px] items-center justify-center p-6 text-center">
                  <div className="max-w-md space-y-2">
                    <h2 className="text-lg font-semibold">Выберите встречу</h2>
                    <p className="text-sm text-muted-foreground">
                      Слева доступен список встреч. После выбора здесь откроется результат обработки.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
      <Sheet
        open={createOpen}
        onOpenChange={(open) => {
          if (!open && isCreating) {
            return
          }
          setCreateOpen(open)
          if (!open) {
            resetCreateMeetingForm()
          }
        }}
      >
        <SheetContent className="w-full gap-0 sm:max-w-[680px]">
          <SheetHeader className="border-b px-5 py-4">
            <SheetTitle>Добавить запись встречи</SheetTitle>
            <SheetDescription>
              Укажите название и загрузите один файл встречи для расшифровки.
            </SheetDescription>
          </SheetHeader>
          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-4 p-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="meeting-title">Название встречи</Label>
                <Input
                  id="meeting-title"
                  value={meetingTitle}
                  onChange={(event) => setMeetingTitle(event.target.value)}
                  placeholder="Например: Статус по проекту за 18 апреля"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="meeting-description">Комментарий</Label>
                <Textarea
                  id="meeting-description"
                  value={meetingDescription}
                  onChange={(event) => setMeetingDescription(event.target.value)}
                  className="min-h-24"
                  placeholder="Короткий контекст для этой записи."
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="meeting-file">Файл встречи</Label>
                <div
                  className={cn(
                    "rounded-lg border border-dashed p-4 transition-colors",
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
                  onDrop={handleMeetingFileDrop}
                >
                  <div className="flex flex-col items-center gap-2 py-3 text-center">
                    <div className="rounded-full bg-secondary p-3">
                      <UploadIcon className="text-primary" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <p className="text-sm font-medium">
                        Перетащите запись сюда или выберите файл вручную
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Поддерживаются аудио и видеофайлы. Для встречи используется только один файл.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => meetingFileInputRef.current?.click()}
                    >
                      Выбрать файл
                    </Button>
                  </div>
                </div>
                <Input
                  ref={meetingFileInputRef}
                  id="meeting-file"
                  type="file"
                  accept={MEETING_FILE_ACCEPT}
                  className="sr-only"
                  onChange={(event) => {
                    selectMeetingFile(Array.from(event.target.files ?? [])[0] ?? null)
                    event.currentTarget.value = ""
                  }}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {meetingFile ? (
                  <Badge variant="secondary" className="gap-1.5 pr-1">
                    <span className="max-w-[360px] truncate">{meetingFile.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="h-4 w-4 hover:bg-background/60"
                      onClick={() => selectMeetingFile(null)}
                      aria-label={`Удалить файл ${meetingFile.name}`}
                    >
                      <XIcon className="size-3" />
                    </Button>
                  </Badge>
                ) : (
                  <Badge variant="outline">Файл не выбран</Badge>
                )}
              </div>

              {createError ? (
                <Alert variant="destructive">
                  <XCircleIcon />
                  <AlertTitle>Не удалось добавить запись</AlertTitle>
                  <AlertDescription>{createError}</AlertDescription>
                </Alert>
              ) : null}

              {createPhase !== "idle" ? (
                <div className="flex flex-col gap-2">
                  <Progress value={createProgress} className="flex-col gap-2">
                    <ProgressLabel>Загрузка и запуск обработки</ProgressLabel>
                    <ProgressValue>
                      {(formattedValue, value) => `${formattedValue ?? value ?? 0}%`}
                    </ProgressValue>
                  </Progress>
                  <div className="text-xs text-muted-foreground">{createMessage}</div>
                </div>
              ) : null}
            </div>
          </ScrollArea>
          <SheetFooter className="border-t px-5 py-4">
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={isCreating}
            >
              Отмена
            </Button>
            <Button
              onClick={() => void handleCreateMeeting()}
              disabled={!meetingTitle.trim() || !meetingFile || isCreating}
            >
              {isCreating ? (
                <Loader2Icon data-icon="inline-start" className="animate-spin" />
              ) : (
                <PlusIcon data-icon="inline-start" />
              )}
              {isCreating ? "Добавляем запись..." : "Добавить запись"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <MeetingInfoSheet
        meeting={selectedMeetingState}
        open={showInfoSheet && Boolean(selectedMeetingState)}
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
        }}
      />
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
  const [isRegeneratingMaterials, setIsRegeneratingMaterials] = useState(false)
  const [copied, setCopied] = useState(false)
  const [markdownMode, setMarkdownMode] = useState<"preview" | "edit">("preview")
  const [markdownDraft, setMarkdownDraft] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [infoMessage, setInfoMessage] = useState<string | null>(null)

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
  const transcriptMarkdown = useMemo(() => buildTranscriptMarkdown(meeting), [meeting])
  const isMeetingProcessing =
    (isMeetingActiveStatus(meeting.status) &&
      getMeetingProcessingProgress(meeting) < 100) ||
    hasEffectiveActiveMeetingJob(meeting)
  const hasMarkdownArtifacts =
    Boolean(getArtifact(meeting, "meeting_summary")?.contentMd?.trim()) ||
    Boolean(getArtifact(meeting, "meeting_protocol")?.contentMd?.trim()) ||
    getActionsItems(meeting).length > 0 ||
    Boolean(getArtifact(meeting, "meeting_actions")?.contentMd?.trim())

  useEffect(() => {
    setMarkdownDraft(combinedMarkdown)
  }, [combinedMarkdown])

  useEffect(() => {
    setSpeakerDrafts(
      Object.fromEntries(
        initialMeeting.speakers.map((speaker) => [
          speaker.id,
          speakerOverrides[speaker.id] ?? speaker.displayName,
        ])
      )
    )
  }, [initialMeeting, speakerOverrides])

  const hasSpeakerChanges = useMemo(
    () =>
      meeting.speakers.some((speaker) => {
        const draft = (speakerDrafts[speaker.id] ?? "").trim()
        return draft.length > 0 && draft !== speaker.displayName
      }),
    [meeting.speakers, speakerDrafts]
  )

  const handleCopyMarkdown = async () => {
    await navigator.clipboard.writeText(markdownDraft)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const handleDownloadMarkdown = () => {
    downloadText(`${safeDownloadName(meeting.title)}.md`, markdownDraft)
  }

  const handleDownloadTranscriptMarkdown = () => {
    downloadText(
      `${safeDownloadName(meeting.title)}-transcript.md`,
      transcriptMarkdown
    )
  }

  const handleRegenerateMaterials = async () => {
    setIsRegeneratingMaterials(true)
    setError(null)
    setInfoMessage(null)

    try {
      const changedSpeakers = meeting.speakers.filter((speaker) => {
        const draft = (speakerDrafts[speaker.id] ?? "").trim()
        return draft.length > 0 && draft !== speaker.displayName
      })

      for (const speaker of changedSpeakers) {
        setSavingSpeakerId(speaker.id)
        const updated = await updateMeetingSpeaker(
          meetingId,
          speaker.id,
          (speakerDrafts[speaker.id] ?? "").trim()
        )
        setSpeakerOverrides((current) => ({
          ...current,
          [updated.id]: updated.displayName,
        }))
        setSpeakerDrafts((current) => ({
          ...current,
          [updated.id]: updated.displayName,
        }))
      }

      setSavingSpeakerId(null)

      for (const stage of [
        "meeting_summary",
        "meeting_protocol",
        "meeting_actions",
      ] as const) {
        await generateMeetingStage(meetingId, {
          stage,
          overwriteExisting: true,
        })
      }

      setInfoMessage(
        "Материалы отправлены на повторную генерацию. Сводка, протокол и поручения обновятся автоматически."
      )
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Не удалось запустить повторную генерацию материалов"
      )
    } finally {
      setSavingSpeakerId(null)
      setIsRegeneratingMaterials(false)
    }
  }

  return (
    <div
      className={
        embedded
          ? "h-full min-h-0 bg-transparent"
          : "min-h-screen bg-transparent"
      }
    >
      <div
        className={
          embedded
            ? "flex min-h-0 flex-col gap-3 p-3"
            : "mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8"
        }
      >
        {embedded ? null : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-border/70 bg-card/95 px-4 py-3 shadow-sm">
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/meetings" />}>
              <ArrowLeftIcon data-icon="inline-start" />
              К списку
            </Button>
          </div>
        )}

        {error ? (
          <Alert variant="destructive">
            <XCircleIcon />
            <AlertTitle>Не удалось сохранить спикера</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {infoMessage ? (
          <Alert>
            <InfoIcon />
            <AlertTitle>Материалы обновляются</AlertTitle>
            <AlertDescription>{infoMessage}</AlertDescription>
          </Alert>
        ) : null}

        {isMeetingProcessing ? <MeetingProcessingState meeting={meeting} /> : null}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-col gap-3">
          <TabsList className="w-full justify-start overflow-x-auto rounded-full bg-muted/70 p-1 shadow-sm">
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

          <TabsContent value="markdown" className="space-y-3">
            <Card>
              <CardHeader className="border-b border-border/70 bg-muted/20 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-full border border-border/70 bg-muted/50 p-1 shadow-sm">
                      <Button
                        type="button"
                        variant={markdownMode === "preview" ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => setMarkdownMode("preview")}
                        className="rounded-md"
                      >
                        Предпросмотр
                      </Button>
                      <Button
                        type="button"
                        variant={markdownMode === "edit" ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => setMarkdownMode("edit")}
                        className="rounded-md"
                      >
                        Редактирование
                      </Button>
                    </div>
                    <Button size="sm" variant="outline" onClick={handleCopyMarkdown}>
                      <CopyIcon data-icon="inline-start" />
                      {copied ? "Скопировано" : "Копировать"}
                    </Button>
                    <Button size="sm" onClick={handleDownloadMarkdown}>
                      <DownloadIcon data-icon="inline-start" />
                      Скачать .md
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 p-4">
                {markdownMode === "preview" ? (
                  !hasMarkdownArtifacts && isMeetingProcessing ? (
                    <MarkdownLoadingState />
                  ) : (
                    <ScrollArea className="h-[560px] rounded-2xl border border-border/70 bg-background/80 px-6 py-5 shadow-sm">
                      <div className="max-w-none">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={markdownComponents()}
                        >
                          {markdownDraft}
                        </ReactMarkdown>
                      </div>
                    </ScrollArea>
                  )
                ) : (
                  <Textarea
                    value={markdownDraft}
                    onChange={(event) => setMarkdownDraft(event.target.value)}
                    className="min-h-[560px] font-mono text-xs leading-6"
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="transcript" className="space-y-3">
            <Card>
              <CardHeader className="border-b border-border/70 bg-muted/20 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <CardTitle>Диаризованный транскрипт</CardTitle>
                    <CardDescription>
                      Только текст с разделением по спикерам, который удобно читать и править.
                    </CardDescription>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDownloadTranscriptMarkdown}
                    disabled={meeting.segments.length === 0}
                  >
                    <DownloadIcon data-icon="inline-start" />
                    Скачать полный .md
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[620px]">
                  {meeting.segments.length > 0 ? (
                    <div className="flex flex-col gap-2 p-4">
                      {meeting.segments.map((segment) => (
                        <div
                          key={segment.id}
                          className="rounded-xl border border-border/70 bg-card/95 px-3 py-2.5 shadow-sm"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">
                              {segment.displayName || segment.speakerLabel}
                            </Badge>
                            <Badge variant="secondary">
                              {Math.floor(segment.startMs / 1000)}s -{" "}
                              {Math.floor(segment.endMs / 1000)}s
                            </Badge>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                            {segment.text || "—"}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : isMeetingProcessing ? (
                    <TranscriptLoadingState />
                  ) : (
                    <div className="flex flex-col gap-2 p-4">
                      <EmptyState
                        icon={FileTextIcon}
                        title="Транскрипт пока пуст"
                        description="Когда активный STT-провайдер вернёт диаризованные сегменты, они появятся здесь."
                      />
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="speakers" className="space-y-3">
            <Card>
              <CardHeader className="border-b border-border/70 bg-muted/20 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>Ручная правка speaker labels</CardTitle>
                    <CardDescription>
                      Можно переименовать любой label в понятное пользователю имя.
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => void handleRegenerateMaterials()}
                    disabled={isRegeneratingMaterials || isMeetingProcessing || savingSpeakerId !== null}
                  >
                    {isRegeneratingMaterials ? (
                      <Loader2Icon data-icon="inline-start" className="animate-spin" />
                    ) : (
                      <SaveIcon data-icon="inline-start" />
                    )}
                    {isRegeneratingMaterials
                      ? "Сохраняем и запускаем пересборку..."
                      : hasSpeakerChanges
                        ? "Сохранить и переформировать материалы"
                        : "Переформировать материалы"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Label</TableHead>
                      <TableHead>Отображаемое имя</TableHead>
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
