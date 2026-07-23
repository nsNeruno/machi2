import {
  CanActivate,
  type CustomDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AdminRequest } from './admin-context';
import { AdminSessionService } from './admin-session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Mark a route as superadmin-only (checked after authentication). */
export const SUPERADMIN_ONLY = 'superadmin_only';
export const SuperadminOnly = (): CustomDecorator => SetMetadata(SUPERADMIN_ONLY, true);

/**
 * Authenticates the admin session cookie, enforces CSRF on state-changing requests, and
 * gates superadmin-only routes. Authorization by location grant is done per-action in the
 * service — hiding in the UI is never the boundary.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly sessionService: AdminSessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();

    const session = await this.sessionService.resolve(request);
    if (!session) {
      throw new UnauthorizedException({
        code: 'admin_auth_required',
        message: 'Sign in to continue.',
      });
    }

    if (!SAFE_METHODS.has(request.method)) {
      const supplied = this.header(request, 'x-csrf-token');
      if (!this.sessionService.csrfMatches(session, supplied)) {
        throw new ForbiddenException({
          code: 'csrf_token_invalid',
          message: 'Missing or invalid CSRF token.',
        });
      }
    }

    request.admin = { user: session.user, sessionId: session.sessionId, csrfToken: session.csrfToken };

    const superadminOnly = this.reflector.getAllAndOverride<boolean>(SUPERADMIN_ONLY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (superadminOnly && session.user.role !== 'superadmin') {
      throw new ForbiddenException({
        code: 'superadmin_required',
        message: 'This action requires a superadmin.',
      });
    }

    return true;
  }

  private header(request: AdminRequest, name: string): string | undefined {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }
}
