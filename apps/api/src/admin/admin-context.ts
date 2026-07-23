import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { adminUsers } from '../db/schema';

export type AuthenticatedAdmin = {
  user: typeof adminUsers.$inferSelect;
  sessionId: string;
  csrfToken: string;
};

export type AdminRequest = FastifyRequest & { admin?: AuthenticatedAdmin };

/** Injects the authenticated admin attached by AdminGuard. */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedAdmin => {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    if (!request.admin) {
      throw new Error('CurrentAdmin used without AdminGuard.');
    }
    return request.admin;
  },
);
