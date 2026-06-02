"use client"

import { useMemo } from "react"
import { ChevronDownIcon, LogOutIcon, PencilIcon } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { AuthUser } from "@/lib/ecolms-api"

function getUserInitials(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (parts.length === 0) {
    return "U"
  }

  if (parts.length === 1) {
    return parts[0]?.slice(0, 2).toUpperCase() ?? "U"
  }

  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase() || "U"
}

function roleLabel(role: AuthUser["role"]) {
  return role === "admin" ? "Администратор" : "Редактор"
}

export function UserMenu({
  user,
  promptsHref,
  promptsLabel = "Промпты",
  className,
}: {
  user: AuthUser
  promptsHref?: string | null
  promptsLabel?: string
  className?: string
}) {
  const initials = useMemo(() => getUserInitials(user.name), [user.name])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Меню пользователя"
        className={cn(
          "group inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/95 px-1.5 py-1.5 text-left text-sm text-foreground shadow-sm transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          className
        )}
      >
        <Avatar className="size-10">
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <ChevronDownIcon className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-72">
        <div className="px-2 py-2">
          <div className="flex items-center gap-3">
            <Avatar className="size-11">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{user.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {roleLabel(user.role)}
              </div>
            </div>
          </div>
        </div>
        {promptsHref ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="items-start gap-3 py-2"
              onClick={() => window.location.assign(promptsHref)}
            >
              <PencilIcon className="mt-0.5 size-4" />
              <div className="space-y-0.5">
                <div className="whitespace-nowrap font-medium">{promptsLabel}</div>
                <div className="text-xs text-muted-foreground">
                  Открыть настройки prompt templates.
                </div>
              </div>
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          className="items-start gap-3 py-2"
          onClick={() => window.location.assign("/api/auth/logout")}
        >
          <LogOutIcon className="mt-0.5 size-4" />
          <div className="space-y-0.5">
            <div className="whitespace-nowrap font-medium">Выйти</div>
            <div className="text-xs text-muted-foreground">Завершить текущую сессию.</div>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
