"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { AlertCircleIcon, ArrowLeftIcon, Loader2Icon, SaveIcon, WandSparklesIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { UserMenu } from "@/components/user-menu"
import { cn } from "@/lib/utils"
import {
  listPrompts,
  type AuthUser,
  type PromptModule,
  type PromptRecord,
  updatePrompt,
} from "@/lib/ecolms-api"

type PromptDraft = {
  title: string
  prompt: string
  userPromptTemplate: string
}

type PromptEditorWorkspaceProps = {
  currentUser: AuthUser
  preferredModule?: PromptModule
  backHref: string
  backLabel: string
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

export function PromptEditorWorkspace({
  currentUser,
  preferredModule = "lms",
  backHref,
  backLabel,
}: PromptEditorWorkspaceProps) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prompts, setPrompts] = useState<PromptRecord[]>([])
  const [selectedPromptKey, setSelectedPromptKey] = useState<string | null>(null)
  const [promptDraft, setPromptDraft] = useState<PromptDraft>({
    title: "",
    prompt: "",
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
      prompt: prompt.systemPrompt,
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
          prompt: "",
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
        systemPrompt: promptDraft.prompt.trim(),
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
    void refreshPrompts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredModule])

  return (
    <div className="min-h-screen bg-transparent">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <header className="rounded-3xl border border-border/70 bg-card/95 px-5 py-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={backHref} />}>
                  <ArrowLeftIcon data-icon="inline-start" />
                  {backLabel}
                </Button>
                <Badge variant="secondary">
                  <WandSparklesIcon data-icon="inline-start" />
                  Промпты
                </Badge>
              </div>
              <div className="space-y-2">
                <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
                  Редактор промптов
                </h1>
                <p className="max-w-2xl text-sm leading-7 text-muted-foreground">
                  Единое место для настройки системных подсказок LMS и встреч. Формат ответов
                  остаётся управляемым, а редактирование - быстрым и спокойным.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">LMS</Badge>
              <Badge variant="outline">Meetings</Badge>
              <UserMenu user={currentUser} />
            </div>
          </div>
        </header>

        <section className="grid flex-1 gap-3 xl:grid-cols-[360px_minmax(0,1fr)]">
          <Card className="flex min-h-[760px] flex-col overflow-hidden border-border/70 bg-card/95 shadow-sm">
            <CardHeader className="border-b border-border/70 bg-muted/35 px-4 py-3">
              <CardTitle>Список промптов</CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 p-0">
              <ScrollArea className="h-[760px]">
                <div className="flex flex-col gap-4 p-4">
                  {loading ? (
                    Array.from({ length: 8 }).map((_, index) => (
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
            </CardContent>
          </Card>

          <Card className="flex min-h-[760px] flex-col overflow-hidden border-border/70 bg-card/95 shadow-sm">
            <CardHeader className="border-b border-border/70 bg-muted/20 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle>Редактор промпта</CardTitle>
                  <div className="text-sm text-muted-foreground">
                    Редактирование применяется без деплоя. Технический формат ответа
                    закреплён системой и не показывается в этом редакторе.
                  </div>
                </div>
                {selectedPrompt ? (
                  <Badge variant="outline">Обновлён {formatDateLabel(selectedPrompt.updatedAt)}</Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 p-0">
              <ScrollArea className="h-[760px]">
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
                      <div className="space-y-1">
                        <div className="text-lg font-semibold">{selectedPrompt.title}</div>
                        <div className="text-sm text-muted-foreground">
                          {promptGroupLabel(selectedPrompt.module)} / {selectedPrompt.promptKey}
                        </div>
                      </div>

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
                        <Label htmlFor="prompt-text">Промпт</Label>
                        <Textarea
                          id="prompt-text"
                          value={promptDraft.prompt}
                          onChange={(event) =>
                            setPromptDraft((current) => ({
                              ...current,
                              prompt: event.target.value,
                            }))
                          }
                          className="min-h-[560px] font-mono text-xs leading-6"
                        />
                        <div className="text-xs text-muted-foreground">
                          Служебные требования к JSON, обязательным полям и входным
                          данным применяются автоматически.
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2 border-t pt-4">
                        <Button variant="outline" onClick={() => void refreshPrompts()}>
                          Перезагрузить
                        </Button>
                        <Button onClick={() => void handleSavePrompt()} disabled={!selectedPrompt || saving}>
                          {saving ? (
                            <Loader2Icon data-icon="inline-start" className="animate-spin" />
                          ) : (
                            <SaveIcon data-icon="inline-start" />
                          )}
                          {saving ? "Сохраняем..." : "Сохранить промпт"}
                        </Button>
                      </div>
                    </>
                  ) : loading ? null : (
                    <div className="flex min-h-[520px] items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/10 p-8 text-center text-sm text-muted-foreground">
                      Выберите промпт слева, чтобы открыть его в редакторе.
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  )
}
