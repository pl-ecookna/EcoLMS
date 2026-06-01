import { createParamDecorator, type ExecutionContext } from "@nestjs/common"

import type { CurrentUser } from "./auth.types"

export const CurrentUserDecorator = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentUser | null => {
    const request = context.switchToHttp().getRequest<{ currentUser?: CurrentUser }>()
    return request.currentUser ?? null
  },
)
