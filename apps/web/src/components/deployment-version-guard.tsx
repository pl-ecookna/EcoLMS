"use client"

import { useEffect, useState } from "react"
import { RefreshCwIcon } from "lucide-react"

import { APP_BUILD_ID } from "@/lib/build-info"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

type VersionState = "checking" | "matched" | "mismatch"

export function DeploymentVersionGuard() {
  const [state, setState] = useState<VersionState>("checking")

  useEffect(() => {
    let cancelled = false

    const checkVersion = async () => {
      try {
        const response = await fetch("/api/version", {
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
        })

        if (!response.ok) {
          return
        }

        const payload: unknown = await response.json()
        const serverBuildId =
          typeof payload === "object" &&
          payload !== null &&
          "buildId" in payload &&
          typeof (payload as { buildId?: unknown }).buildId === "string"
            ? (payload as { buildId: string }).buildId
            : null

        if (!serverBuildId || cancelled) {
          return
        }

        setState(serverBuildId === APP_BUILD_ID ? "matched" : "mismatch")
      } catch {
        // Network failures should not block the page.
      }
    }

    void checkVersion()

    const intervalId = window.setInterval(() => {
      void checkVersion()
    }, 5 * 60 * 1000)

    const handleFocus = () => {
      void checkVersion()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkVersion()
      }
    }

    window.addEventListener("focus", handleFocus)
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      window.removeEventListener("focus", handleFocus)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [])

  if (state !== "mismatch") {
    return null
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <Alert className="pointer-events-auto w-full max-w-lg border-amber-200 bg-background/95 shadow-lg backdrop-blur">
        <AlertTitle>Доступна новая версия приложения</AlertTitle>
        <AlertDescription className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>Эта вкладка открыта со старым кешем. Обновите страницу, чтобы подхватить свежий деплой.</span>
          <Button
            type="button"
            size="sm"
            onClick={() => window.location.reload()}
            className="shrink-0"
          >
            <RefreshCwIcon className="size-4" />
            Обновить страницу
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  )
}
