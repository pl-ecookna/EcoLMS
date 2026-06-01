import { redirect } from "next/navigation"

import { LoginScreen } from "@/components/login-screen"
import { getOptionalAuthUser } from "@/lib/auth/server"

function normalizeError(value: string | undefined) {
  const text = value?.trim()
  return text ? text : null
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: {
    error?: string
    returnTo?: string
  }
}) {
  const user = await getOptionalAuthUser()
  const returnTo = searchParams?.returnTo?.startsWith("/") ? searchParams.returnTo : "/"
  if (user) {
    redirect(returnTo)
  }

  const loginUrl = `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`
  return <LoginScreen error={normalizeError(searchParams?.error)} loginUrl={loginUrl} />
}
