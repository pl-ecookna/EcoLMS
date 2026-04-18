"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertCircleIcon, Loader2Icon, SaveIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  listPrompts,
  type PromptModule,
  type PromptRecord,
  updatePrompt,
} from "@/lib/ecolms-api"

type PromptDraft = {
  title: string
  systemPrompt: string
  userPromptTemplate: string
}

type PromptEditorDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  preferredModule?: PromptModule
}

function promptGroupLabel(module: PromptModule) {
  return module === "lms" ? "LMS" : "Meetings"
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

export function PromptEditorDialog({
  open,
  onOpenChange,
  preferredModule = "lms",
}: PromptEditorDialogProps) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prompts, setPrompts] = useState<PromptRecord[]>([])
  const [selectedPromptKey, setSelectedPromptKey] = useState<string | null>(null)
  const [promptDraft, setPromptDraft] = useState<PromptDraft>({
    title: "",
    systemPrompt: "",
    userPromptTemplate: "",
  })

  const promptGroups = useMemo(
    () =>
      prompts.reduce<Record<PromptModule, PromptRecord[]>>(
        (accumulator, prompt) => {
          accumulator[prompt.module] = [...(accumulator[prompt.module] ?? []), prompt]
          return accumulator
        },
        { lms: [], meetings: [] }
      ),
    [prompts]
  )

  const selectedPrompt = prompts.find(
    (prompt) => `${prompt.module}:${prompt.promptKey}` === selectedPromptKey
  )

  function selectPrompt(prompt: PromptRecord) {
    setSelectedPromptKey(`${prompt.module}:${prompt.promptKey}`)
    setPromptDraft({
      title: prompt.title,
      systemPrompt: prompt.systemPrompt,
      userPromptTemplate: prompt.userPromptTemplate,
    })
  }

  async function refreshPrompts() {
    setLoading(true)
    setError(null)
    try {
      const response = await listPrompts()
      setPrompts(response)

      const preferredPrompt =
        response.find((prompt) => `${prompt.module}:${prompt.promptKey}` === selectedPromptKey) ??
        response.find((prompt) => prompt.module === preferredModule) ??
        response[0] ??
        null

      if (preferredPrompt) {
        selectPrompt(preferredPrompt)
      } else {
        setSelectedPromptKey(null)
        setPromptDraft({
          title: "",
          systemPrompt: "",
          userPromptTemplate: "",
        })
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить промпты")
    } finally {
      setLoading(false)
    }
  }

  async function handleSavePrompt() {
    if (!selectedPrompt) {
      return
    }

    setSaving(true)
    setError(null)
    try {
      const updated = await updatePrompt(selectedPrompt.module, selectedPrompt.promptKey, {
        title: promptDraft.title.trim(),
        systemPrompt: promptDraft.systemPrompt,
        userPromptTemplate: promptDraft.userPromptTemplate,
      })

      setPrompts((current) =>
        current.map((prompt) =>
          prompt.module === updated.module && prompt.promptKey === updated.promptKey
            ? updated
            : prompt
        )
      )
      selectPrompt(updated)
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Не удалось сохранить изменения"
      )
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!open) {
      return
    }
    void refreshPrompts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preferredModule])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(920px,calc(100vh-2rem))] max-w-[min(1280px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle>Редактирование промптов</DialogTitle>
          <DialogDescription>
            Промпты для <code>lms</code> и <code>meetings</code> хранятся в базе данных и
            применяются worker-ом без деплоя.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-0 md:grid-cols-[300px_minmax(0,1fr)]">
          <div className="border-b md:border-r md:border-b-0">
            <ScrollArea className="h-full">
              <div className="flex flex-col gap-4 p-4">
                {loading ? (
                  Array.from({ length: 6 }).map((_, index) => (
                    <Skeleton key={index} className="h-16 w-full rounded-xl" />
                  ))
                ) : (
                  (["lms", "meetings"] as const).map((module) =>
                    promptGroups[module].length ? (
                      <div key={module} className="space-y-2">
                        <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                          {promptGroupLabel(module)}
                        </div>
                        <div className="flex flex-col gap-2">
                          {promptGroups[module].map((prompt) => {
                            const isActive =
                              `${prompt.module}:${prompt.promptKey}` === selectedPromptKey

                            return (
                              <button
                                key={`${prompt.module}:${prompt.promptKey}`}
                                type="button"
                                className={cn(
                                  "rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-muted/35",
                                  isActive
                                    ? "border-primary/40 bg-muted/40 shadow-sm"
                                    : "border-border/70 bg-card"
                                )}
                                onClick={() => selectPrompt(prompt)}
                              >
                                <div className="truncate text-sm font-medium">{prompt.title}</div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {prompt.promptKey}
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ) : null
                  )
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="min-h-0">
            <ScrollArea className="h-full">
              <div className="flex flex-col gap-4 p-4">
                {error ? (
                  <Alert variant="destructive">
                    <AlertCircleIcon />
                    <AlertTitle>Ошибка работы с промптами</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}

                {selectedPrompt ? (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="text-lg font-semibold">{selectedPrompt.title}</div>
                        <div className="text-sm text-muted-foreground">
                          {promptGroupLabel(selectedPrompt.module)} / {selectedPrompt.promptKey}
                        </div>
                      </div>
                      <Badge variant="outline">
                        Обновлён {formatDateLabel(selectedPrompt.updatedAt)}
                      </Badge>
                    </div>

                    <div className="grid gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="prompt-title">Название</Label>
                        <Input
                          id="prompt-title"
                          value={promptDraft.title}
                          onChange={(event) =>
                            setPromptDraft((current) => ({
                              ...current,
                              title: event.target.value,
                            }))
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="prompt-system">System prompt</Label>
                        <Textarea
                          id="prompt-system"
                          value={promptDraft.systemPrompt}
                          onChange={(event) =>
                            setPromptDraft((current) => ({
                              ...current,
                              systemPrompt: event.target.value,
                            }))
                          }
                          className="min-h-[280px] font-mono text-xs leading-6"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="prompt-user">User prompt template</Label>
                        <Textarea
                          id="prompt-user"
                          value={promptDraft.userPromptTemplate}
                          onChange={(event) =>
                            setPromptDraft((current) => ({
                              ...current,
                              userPromptTemplate: event.target.value,
                            }))
                          }
                          className="min-h-[220px] font-mono text-xs leading-6"
                        />
                        {selectedPrompt.module === "lms" ? (
                          <div className="text-xs text-muted-foreground">
                            Для LMS можно использовать плейсхолдер{" "}
                            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
                              {"{source_type}"}
                            </code>
                            .
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </>
                ) : loading ? null : (
                  <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/10 p-8 text-center text-sm text-muted-foreground">
                    Выберите промпт слева, чтобы открыть его в редакторе.
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
          <Button onClick={() => void handleSavePrompt()} disabled={!selectedPrompt || saving}>
            {saving ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : (
              <SaveIcon data-icon="inline-start" />
            )}
            {saving ? "Сохраняем..." : "Сохранить промпт"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
