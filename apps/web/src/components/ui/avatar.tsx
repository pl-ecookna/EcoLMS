import * as React from "react"

import { cn } from "@/lib/utils"

function Avatar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar"
      className={cn(
        "relative flex size-10 shrink-0 overflow-hidden rounded-full border border-border/70 bg-muted text-muted-foreground shadow-sm",
        className
      )}
      {...props}
    />
  )
}

function AvatarFallback({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center bg-gradient-to-br from-emerald-600 to-emerald-400 text-sm font-semibold text-white",
        className
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarFallback }
