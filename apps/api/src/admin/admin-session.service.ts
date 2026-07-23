import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { eq, lt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { v7 as uuidv7 } from 'uuid';

import { getEnvironment } from '../config/environment';
import { DbService } from '../db/db.service';
import { adminSessions, adminUsers } from '../db/schema';

export const SESSION_COOKIE_NAME = 'admin_session';
const COOKIE_PATH = '/api';

export type ResolvedSession = {
  sessionId: string;
  csrfToken: string;
  user: typeof adminUsers.$inferSelect;
};

@Injectable()
export class AdminSessionService {
  constructor(private readonly dbService: DbService) {}

  /** Create a session for a user, set the cookie, and return the CSRF token. */
  async issue(reply: FastifyReply, userId: string): Promise<string> {
    const { sessionTtlHours } = getEnvironment();
    const rawToken = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + sessionTtlHours * 3_600_000);

    await this.dbService.db.insert(adminSessions).values({
      id: uuidv7(),
      adminUserId: userId,
      tokenHash: this.hash(rawToken),
      csrfToken,
      expiresAt,
    });

    this.setCookie(reply, rawToken, Math.floor(sessionTtlHours * 3_600));
    return csrfToken;
  }

  /** Resolve the current session from the request cookie, or null if none/expired/inactive. */
  async resolve(request: FastifyRequest): Promise<ResolvedSession | null> {
    const rawToken = this.readCookie(request);
    if (!rawToken) {
      return null;
    }

    const [row] = await this.dbService.db
      .select({ session: adminSessions, user: adminUsers })
      .from(adminSessions)
      .innerJoin(adminUsers, eq(adminSessions.adminUserId, adminUsers.id))
      .where(eq(adminSessions.tokenHash, this.hash(rawToken)))
      .limit(1);

    if (!row) {
      return null;
    }
    if (row.session.expiresAt.getTime() <= Date.now() || !row.user.isActive) {
      await this.dbService.db.delete(adminSessions).where(eq(adminSessions.id, row.session.id));
      return null;
    }

    return { sessionId: row.session.id, csrfToken: row.session.csrfToken, user: row.user };
  }

  csrfMatches(session: ResolvedSession, supplied: string | undefined): boolean {
    if (!supplied) {
      return false;
    }
    const expected = Buffer.from(session.csrfToken, 'utf8');
    const given = Buffer.from(supplied, 'utf8');
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  async revoke(reply: FastifyReply, request: FastifyRequest): Promise<void> {
    const rawToken = this.readCookie(request);
    if (rawToken) {
      await this.dbService.db
        .delete(adminSessions)
        .where(eq(adminSessions.tokenHash, this.hash(rawToken)));
    }
    this.clearCookie(reply);
  }

  /** Drop every session belonging to a user (used on deactivate / password reset). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.dbService.db.delete(adminSessions).where(eq(adminSessions.adminUserId, userId));
  }

  async pruneExpired(now = new Date()): Promise<void> {
    await this.dbService.db.delete(adminSessions).where(lt(adminSessions.expiresAt, now));
  }

  private setCookie(reply: FastifyReply, value: string, maxAgeSeconds: number): void {
    reply.header('set-cookie', this.serializeCookie(value, maxAgeSeconds));
  }

  private clearCookie(reply: FastifyReply): void {
    reply.header('set-cookie', this.serializeCookie('', 0));
  }

  private serializeCookie(value: string, maxAgeSeconds: number): string {
    const { sessionCookieSecure } = getEnvironment();
    const parts = [
      `${SESSION_COOKIE_NAME}=${value}`,
      `Path=${COOKIE_PATH}`,
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${maxAgeSeconds}`,
    ];
    if (sessionCookieSecure) {
      parts.push('Secure');
    }
    return parts.join('; ');
  }

  private readCookie(request: FastifyRequest): string | null {
    const header = request.headers.cookie;
    if (!header) {
      return null;
    }
    for (const pair of header.split(';')) {
      const index = pair.indexOf('=');
      if (index === -1) {
        continue;
      }
      const name = pair.slice(0, index).trim();
      if (name === SESSION_COOKIE_NAME) {
        return pair.slice(index + 1).trim() || null;
      }
    }
    return null;
  }

  private hash(value: string): string {
    return createHash('sha256')
      .update(`${getEnvironment().sessionSecret}:${value}`)
      .digest('hex');
  }
}
