import { Injectable, UnauthorizedException } from '@nestjs/common';
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { DbService } from '../db/db.service';
import { adminUsers } from '../db/schema';

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60_000;
const FAILURE_WINDOW_MS = 15 * 60_000;

type FailureRecord = { count: number; firstAt: number; lockedUntil: number };

/**
 * Verifies admin credentials with argon2 and applies per-key lockout after repeated
 * failures. Lockout state is in-memory: acceptable because the API is single-process by
 * design (ARCHITECTURE "Single-process only"), and a restart only relaxes a soft control.
 */
@Injectable()
export class AdminAuthService {
  private readonly failures = new Map<string, FailureRecord>();
  // A real argon2 hash of a random secret, to equalize verify timing for unknown emails.
  private readonly dummyHash = argon2.hash(randomBytes(32).toString('hex'), {
    type: argon2.argon2id,
  });

  constructor(private readonly dbService: DbService) {}

  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  /** Returns the user on success; throws a generic 401 on any failure. Never reveals cause. */
  async verifyLogin(email: string, password: string, ipKey: string): Promise<typeof adminUsers.$inferSelect> {
    const lockKey = `${email}|${ipKey}`;
    this.assertNotLocked(lockKey);

    const [user] = await this.dbService.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.email, email))
      .limit(1);

    // Always run a verify to keep timing uniform whether or not the email exists.
    const hash = user?.passwordHash ?? (await this.dummyHash);
    const passwordOk = await argon2.verify(hash, password).catch(() => false);

    if (!user || !user.isActive || !passwordOk) {
      this.recordFailure(lockKey);
      throw this.genericFailure();
    }

    this.failures.delete(lockKey);
    return user;
  }

  private assertNotLocked(key: string): void {
    const record = this.failures.get(key);
    if (record && record.lockedUntil > Date.now()) {
      throw this.genericFailure();
    }
  }

  private recordFailure(key: string): void {
    const now = Date.now();
    const existing = this.failures.get(key);
    if (!existing || now - existing.firstAt > FAILURE_WINDOW_MS) {
      this.failures.set(key, { count: 1, firstAt: now, lockedUntil: 0 });
      return;
    }
    existing.count += 1;
    if (existing.count >= MAX_FAILURES) {
      existing.lockedUntil = now + LOCKOUT_MS;
    }
    this.failures.set(key, existing);
  }

  private genericFailure(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'invalid_credentials',
      message: 'Email or password is incorrect.',
    });
  }
}
