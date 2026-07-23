import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DbService } from '../db/db.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminBootstrapService } from './admin-bootstrap.service';

/**
 * Minimal env so getEnvironment() parses; individual tests layer ADMIN_SEED_* on top.
 * ADMIN_SEED_* are explicitly cleared because importing the config loads the repo `.env`,
 * which would otherwise leak real seed values into the "unset" cases.
 */
function stubBaseEnv(): void {
  vi.stubEnv('DATABASE_URL', 'postgres://u:p@localhost:5432/db');
  vi.stubEnv('DEVICE_TOKEN_SECRET', 'x');
  vi.stubEnv('IP_HASH_SALT', 'x');
  vi.stubEnv('SESSION_SECRET', 'x');
  vi.stubEnv('ADMIN_SEED_EMAIL', undefined);
  vi.stubEnv('ADMIN_SEED_PASSWORD', undefined);
}

/** Builds a DbService double whose select() resolves to `existing` and records insert values. */
function makeDb(existing: Array<{ id: string }>) {
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values });
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(existing) }),
      }),
    }),
    insert,
  };
  return { dbService: { db } as unknown as DbService, insert, values };
}

describe('AdminBootstrapService', () => {
  beforeEach(() => stubBaseEnv());
  afterEach(() => vi.unstubAllEnvs());

  const authService = { hashPassword: vi.fn().mockResolvedValue('argon2-hash') } as unknown as AdminAuthService;

  it('creates a superadmin from ADMIN_SEED_* when none exists', async () => {
    vi.stubEnv('ADMIN_SEED_EMAIL', 'Boss@Example.com');
    vi.stubEnv('ADMIN_SEED_PASSWORD', 'hunter2');
    const { dbService, insert, values } = makeDb([]);

    await new AdminBootstrapService(dbService, authService).onApplicationBootstrap();

    expect(insert).toHaveBeenCalledOnce();
    expect(values).toHaveBeenCalledWith(
      // email is normalised (trim + lowercase) by the env schema
      expect.objectContaining({ email: 'boss@example.com', role: 'superadmin', passwordHash: 'argon2-hash' }),
    );
  });

  it('is a no-op when a superadmin already exists', async () => {
    vi.stubEnv('ADMIN_SEED_EMAIL', 'boss@example.com');
    vi.stubEnv('ADMIN_SEED_PASSWORD', 'hunter2');
    const { dbService, insert } = makeDb([{ id: 'existing' }]);

    await new AdminBootstrapService(dbService, authService).onApplicationBootstrap();

    expect(insert).not.toHaveBeenCalled();
  });

  it('is a no-op when ADMIN_SEED_EMAIL is unset', async () => {
    const { dbService, insert } = makeDb([]);

    await new AdminBootstrapService(dbService, authService).onApplicationBootstrap();

    expect(insert).not.toHaveBeenCalled();
  });

  it('skips (without throwing) when the password is missing', async () => {
    vi.stubEnv('ADMIN_SEED_EMAIL', 'boss@example.com');
    const { dbService, insert } = makeDb([]);

    await expect(
      new AdminBootstrapService(dbService, authService).onApplicationBootstrap(),
    ).resolves.toBeUndefined();
    expect(insert).not.toHaveBeenCalled();
  });
});
