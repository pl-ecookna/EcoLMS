export type AppRole = "admin" | "editor"

export type CurrentUser = {
  id: string
  email: string
  name: string
  role: AppRole
  roles: string[]
}

export type AuthenticatedRequest = {
  headers: Record<string, string | string[] | undefined>
  currentUser?: CurrentUser
}
