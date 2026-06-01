import { CanActivate, ExecutionContext, Injectable, InternalServerErrorException, UnauthorizedException } from "@nestjs/common"
import { Reflector } from "@nestjs/core"
import { createHmac } from "node:crypto"

import { IS_PUBLIC_KEY } from "./public.decorator"
import type { AppRole, AuthenticatedRequest } from "./auth.types"

function signPayload(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url")
}

function decodeHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? ""
  }
  return typeof value === "string" ? value : ""
}

@Injectable()
export class InternalAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) {
      return true
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const secret = process.env.ECOLMS_INTERNAL_AUTH_SECRET?.trim()
    if (!secret) {
      throw new InternalServerErrorException("Missing ECOLMS_INTERNAL_AUTH_SECRET")
    }

    const userId = decodeHeaderValue(request.headers["x-ecolms-auth-user-id"])
    const encodedEmail = decodeHeaderValue(request.headers["x-ecolms-auth-email"])
    const encodedName = decodeHeaderValue(request.headers["x-ecolms-auth-name"])
    const role = decodeHeaderValue(request.headers["x-ecolms-auth-role"]) as AppRole
    const rolesValue = decodeHeaderValue(request.headers["x-ecolms-auth-roles"])
    const signature = decodeHeaderValue(request.headers["x-ecolms-auth-signature"])

    if (!userId || !encodedEmail || !encodedName || !role || !signature) {
      throw new UnauthorizedException("Missing trusted auth headers")
    }
    if (role !== "admin" && role !== "editor") {
      throw new UnauthorizedException("Unsupported application role")
    }

    const payload = [userId, encodedEmail, encodedName, role, rolesValue].join("|")
    if (signPayload(payload, secret) !== signature) {
      throw new UnauthorizedException("Invalid trusted auth signature")
    }

    const roles = rolesValue
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)

    request.currentUser = {
      id: userId,
      email: decodeURIComponent(encodedEmail),
      name: decodeURIComponent(encodedName),
      role,
      roles,
    }

    return true
  }
}
