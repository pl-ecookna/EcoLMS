import Link from "next/link"
import { LockIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-8">
      <Card className="w-full max-w-xl border-border/70 bg-card/95 shadow-sm">
        <CardHeader className="space-y-4">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <LockIcon className="size-6" />
          </div>
          <div className="space-y-2">
            <CardTitle>Недостаточно прав</CardTitle>
            <CardDescription>
              У вашей учётной записи нет доступа к этому разделу EcoLMS. Если нужен доступ,
              назначьте соответствующую роль в EcoAuth.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Button nativeButton={false} render={<Link href="/" />}>
            Вернуться в EcoLMS
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
