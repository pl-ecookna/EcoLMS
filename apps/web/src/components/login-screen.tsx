import { ArrowRightIcon, LockIcon, ShieldCheckIcon, SparklesIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type LoginScreenProps = {
  error: string | null
  loginUrl: string
}

export function LoginScreen({ error, loginUrl }: LoginScreenProps) {
  return (
    <main className="relative min-h-svh overflow-hidden bg-transparent">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 left-[-6rem] h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute top-24 right-[-5rem] h-64 w-64 rounded-full bg-secondary/10 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-48 w-48 rounded-full bg-accent/60 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-svh w-full max-w-7xl items-center px-4 py-8 sm:px-6 lg:px-8">
        <div className="w-full">
          <section className="overflow-hidden rounded-[2rem] border border-border/60 bg-card/85 p-6 shadow-sm backdrop-blur-sm sm:p-8 lg:p-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-primary">
              <SparklesIcon className="size-3.5" />
              LMS
            </div>

            <div className="mt-6 max-w-3xl space-y-4">
              <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-[3rem]">
                Вход в EcoLMS
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                Единый вход для доступа к курсам, встречам и настройкам промптов.
              </p>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <Card className="border-border/60 bg-background/80">
                <CardHeader className="space-y-3">
                  <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <ShieldCheckIcon className="size-5" />
                  </div>
                  <CardTitle className="text-base">Единый вход</CardTitle>
                  <CardDescription>
                    Один логин для всех внутренних сервисов EcoAuth.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-border/60 bg-background/80">
                <CardHeader className="space-y-3">
                  <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <LockIcon className="size-5" />
                  </div>
                  <CardTitle className="text-base">Защищённая сессия</CardTitle>
                  <CardDescription>
                    Сессия хранится в приложении и используется для безопасного доступа к API.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-border/60 bg-background/80">
                <CardHeader className="space-y-3">
                  <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <SparklesIcon className="size-5" />
                  </div>
                  <CardTitle className="text-base">Быстрый старт</CardTitle>
                  <CardDescription>
                    После входа сразу открывается рабочее пространство LMS и модуля встреч.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>

            <div className="mt-8 flex flex-col gap-4 sm:max-w-sm">
              {error ? (
                <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              ) : null}
              <Button className="w-full" nativeButton={false} render={<a href={loginUrl} />}>
                Войти
                <ArrowRightIcon />
              </Button>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
