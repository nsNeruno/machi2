import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { getEnvironment } from '../config/environment';
import { DbService } from '../db/db.service';
import { adminUsers } from '../db/schema';
import { AdminAuthService } from './admin-auth.service';

/**
 * Ensures a superadmin exists on startup so admin access is available immediately after
 * the very first production deploy — no manual seed step (see INFRASTRUCTURE.md §5, §6).
 *
 * Gated and idempotent by design:
 * - No-op unless ADMIN_SEED_EMAIL is set (so tests and normal restarts do nothing).
 * - No-op if *any* superadmin already exists, so it never clobbers a password an operator
 *   has since changed, and never runs a DB write after the first successful bootstrap.
 */
@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly authService: AdminAuthService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const { adminSeedEmail, adminSeedPassword } = getEnvironment();

    if (!adminSeedEmail) {
      return;
    }
    if (!adminSeedPassword) {
      this.logger.warn('ADMIN_SEED_EMAIL is set but ADMIN_SEED_PASSWORD is missing; skipping admin bootstrap.');
      return;
    }

    const [existing] = await this.dbService.db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.role, 'superadmin'))
      .limit(1);

    if (existing) {
      return;
    }

    const passwordHash = await this.authService.hashPassword(adminSeedPassword);
    await this.dbService.db
      .insert(adminUsers)
      .values({ id: uuidv7(), email: adminSeedEmail, passwordHash, role: 'superadmin' })
      // Tolerate the email already existing as a non-superadmin without failing startup.
      .onConflictDoNothing({ target: adminUsers.email });

    this.logger.log(`Bootstrapped initial superadmin: ${adminSeedEmail}`);
  }
}
