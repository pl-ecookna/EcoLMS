import { PromptEditorWorkspace } from "@/components/prompt-editor-workspace"
import { requireAdminUser } from "@/lib/auth/server"
import type { PromptModule } from "@/lib/ecolms-api"

function normalizeModule(value: string | undefined): PromptModule {
  return value === "meetings" ? "meetings" : "lms"
}

export default async function PromptsPage({
  searchParams,
}: {
  searchParams?: {
    module?: string
    from?: string
  }
}) {
  const currentUser = await requireAdminUser("/prompts")
  const preferredModule = normalizeModule(searchParams?.module)
  const from = searchParams?.from === "meetings" ? "meetings" : "lms"
  const backHref = from === "meetings" ? "/meetings" : "/"
  const backLabel = from === "meetings" ? "Встречи" : "LMS"

  return (
    <PromptEditorWorkspace
      currentUser={currentUser}
      preferredModule={preferredModule}
      backHref={backHref}
      backLabel={backLabel}
    />
  )
}
