import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common"
import { Reflector } from "@nestjs/core"

import { IS_PUBLIC_KEY } from "./public.decorator"
import { ROLES_KEY } from "./roles.decorator"
import type { AppRole, AuthenticatedRequest } from "./auth.types"

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) {
      return true
    }

    const requiredRoles = this.reflector.getAllAndOverride<AppRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!requiredRoles?.length) {
      return true
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const currentRole = request.currentUser?.role
    if (!currentRole || !requiredRoles.includes(currentRole)) {
      throw new ForbiddenException("Недостаточно прав для выполнения действия")
    }

    return true
  }
}
