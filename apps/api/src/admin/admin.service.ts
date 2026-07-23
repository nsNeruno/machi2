import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import argon2 from 'argon2';
import type {
  AdminCommunityNoteInput,
  AdminGameCreateInput,
  AdminGameResponse,
  AdminGameUpdateInput,
  AdminLocationCreateInput,
  AdminLocationResponse,
  AdminLocationUpdateInput,
  AdminQueueBoardResponse,
  AdminUserCreateInput,
  AdminUserResponse,
  AdminUserUpdateInput,
  DoneReason,
} from '@machi2/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { ServiceDateService } from '../common/service-date.service';
import { DbService } from '../db/db.service';
import {
  adminLocationGrants,
  adminUsers,
  games,
  locations,
  queueEntries,
} from '../db/schema';
import { toQueueEntryResponse } from '../queue/queue-entry.presenter';
import { QueueEventsService } from '../queue/queue-events.service';
import { AdminAuthService } from './admin-auth.service';
import type { AuthenticatedAdmin } from './admin-context';
import { AdminSessionService } from './admin-session.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly dbService: DbService,
    private readonly authService: AdminAuthService,
    private readonly sessionService: AdminSessionService,
    private readonly queueEventsService: QueueEventsService,
    private readonly serviceDateService: ServiceDateService,
  ) {}

  // -------------------------------------------------------------------------
  // Grants & authorization
  // -------------------------------------------------------------------------

  async grantedLocationIds(userId: string): Promise<string[]> {
    const rows = await this.dbService.db
      .select({ locationId: adminLocationGrants.locationId })
      .from(adminLocationGrants)
      .where(eq(adminLocationGrants.adminUserId, userId));
    return rows.map((row) => row.locationId);
  }

  private async assertLocationAccess(admin: AuthenticatedAdmin, locationId: string): Promise<void> {
    if (admin.user.role === 'superadmin') {
      return;
    }
    const [grant] = await this.dbService.db
      .select({ locationId: adminLocationGrants.locationId })
      .from(adminLocationGrants)
      .where(
        and(
          eq(adminLocationGrants.adminUserId, admin.user.id),
          eq(adminLocationGrants.locationId, locationId),
        ),
      )
      .limit(1);
    if (!grant) {
      throw new ForbiddenException({
        code: 'location_forbidden',
        message: 'You do not have access to this location.',
      });
    }
  }

  private async gameContext(
    admin: AuthenticatedAdmin,
    gameId: string,
  ): Promise<{ game: typeof games.$inferSelect; location: typeof locations.$inferSelect }> {
    const [row] = await this.dbService.db
      .select({ game: games, location: locations })
      .from(games)
      .innerJoin(locations, eq(games.locationId, locations.id))
      .where(eq(games.id, gameId))
      .limit(1);
    if (!row) {
      throw new NotFoundException({ code: 'game_not_found', message: 'Game not found.' });
    }
    await this.assertLocationAccess(admin, row.location.id);
    return row;
  }

  // -------------------------------------------------------------------------
  // Locations
  // -------------------------------------------------------------------------

  async listLocations(admin: AuthenticatedAdmin): Promise<AdminLocationResponse[]> {
    const gameCount = sql<number>`count(${games.id})`.mapWith(Number);
    const visibility =
      admin.user.role === 'superadmin'
        ? undefined
        : inArray(locations.id, await this.grantedLocationIds(admin.user.id));

    const rows = await this.dbService.db
      .select({
        id: locations.id,
        slug: locations.slug,
        name: locations.name,
        address: locations.address,
        timezone: locations.timezone,
        isActive: locations.isActive,
        requireApprovalForOthers: locations.requireApprovalForOthers,
        staffPinHash: locations.staffPinHash,
        gameCount,
      })
      .from(locations)
      .leftJoin(games, eq(games.locationId, locations.id))
      .where(visibility)
      .groupBy(locations.id)
      .orderBy(asc(locations.name));

    return rows.map((row) => this.toLocationResponse(row));
  }

  async createLocation(input: AdminLocationCreateInput): Promise<AdminLocationResponse> {
    await this.assertSlugFree(input.slug, null);
    const staffPinHash = input.staffPin ? await argon2.hash(input.staffPin, { type: argon2.argon2id }) : null;

    const [created] = await this.dbService.db
      .insert(locations)
      .values({
        id: uuidv7(),
        slug: input.slug,
        name: input.name,
        address: input.address ?? null,
        timezone: input.timezone,
        isActive: input.isActive,
        requireApprovalForOthers: input.requireApprovalForOthers,
        staffPinHash,
      })
      .returning();
    if (!created) {
      throw new ConflictException({ code: 'location_create_failed', message: 'Could not create location.' });
    }
    return { ...this.toLocationResponse({ ...created, gameCount: 0 }) };
  }

  async updateLocation(
    admin: AuthenticatedAdmin,
    locationId: string,
    input: AdminLocationUpdateInput,
  ): Promise<AdminLocationResponse> {
    await this.assertLocationAccess(admin, locationId);
    const existing = await this.findLocation(locationId);

    if (input.slug && input.slug !== existing.slug) {
      await this.assertSlugFree(input.slug, locationId);
    }

    const requireApproval = input.requireApprovalForOthers ?? existing.requireApprovalForOthers;
    let staffPinHash = existing.staffPinHash;
    if (input.staffPin === '') {
      staffPinHash = null;
    } else if (typeof input.staffPin === 'string' && input.staffPin.length > 0) {
      staffPinHash = await argon2.hash(input.staffPin, { type: argon2.argon2id });
    }
    if (requireApproval && !staffPinHash) {
      throw new BadRequestException({
        code: 'staff_pin_required',
        message: 'A staff PIN is required when approval is on.',
      });
    }

    const [updated] = await this.dbService.db
      .update(locations)
      .set({
        name: input.name ?? existing.name,
        slug: input.slug ?? existing.slug,
        address: input.address === undefined ? existing.address : input.address,
        timezone: input.timezone ?? existing.timezone,
        isActive: input.isActive ?? existing.isActive,
        requireApprovalForOthers: requireApproval,
        staffPinHash,
      })
      .where(eq(locations.id, locationId))
      .returning();
    if (!updated) {
      throw new NotFoundException({ code: 'location_not_found', message: 'Location not found.' });
    }
    const [gameCountRow] = await this.dbService.db
      .select({ value: sql<number>`count(*)`.mapWith(Number) })
      .from(games)
      .where(eq(games.locationId, locationId));
    return this.toLocationResponse({ ...updated, gameCount: gameCountRow?.value ?? 0 });
  }

  async deleteLocation(locationId: string): Promise<void> {
    const result = await this.dbService.db
      .delete(locations)
      .where(eq(locations.id, locationId))
      .returning({ id: locations.id });
    if (result.length === 0) {
      throw new NotFoundException({ code: 'location_not_found', message: 'Location not found.' });
    }
  }

  async slugAvailable(slug: string, excludeId?: string): Promise<boolean> {
    const [row] = await this.dbService.db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.slug, slug))
      .limit(1);
    return !row || row.id === excludeId;
  }

  // -------------------------------------------------------------------------
  // Games
  // -------------------------------------------------------------------------

  async listGames(admin: AuthenticatedAdmin, locationId: string): Promise<AdminGameResponse[]> {
    await this.assertLocationAccess(admin, locationId);
    const rows = await this.dbService.db
      .select({
        game: games,
        editorEmail: adminUsers.email,
      })
      .from(games)
      .leftJoin(adminUsers, eq(games.communityNoteUpdatedBy, adminUsers.id))
      .where(eq(games.locationId, locationId))
      .orderBy(asc(games.sortOrder), asc(games.name));
    return rows.map((row) => this.toGameResponse(row.game, row.editorEmail));
  }

  async createGame(
    admin: AuthenticatedAdmin,
    locationId: string,
    input: AdminGameCreateInput,
  ): Promise<AdminGameResponse> {
    await this.assertLocationAccess(admin, locationId);
    const [maxSortRow] = await this.dbService.db
      .select({ value: sql<number>`coalesce(max(${games.sortOrder}), 0)`.mapWith(Number) })
      .from(games)
      .where(eq(games.locationId, locationId));
    const maxSort = maxSortRow?.value ?? 0;

    const [created] = await this.dbService.db
      .insert(games)
      .values({
        id: uuidv7(),
        locationId,
        name: input.name,
        cabinetLabel: input.cabinetLabel ?? null,
        boardMode: input.boardMode,
        maxQueueLen: input.maxQueueLen ?? null,
        isActive: input.isActive,
        sortOrder: maxSort + 10,
      })
      .returning();
    if (!created) {
      throw new ConflictException({ code: 'game_create_failed', message: 'Could not create game.' });
    }
    return this.toGameResponse(created, null);
  }

  async updateGame(
    admin: AuthenticatedAdmin,
    gameId: string,
    input: AdminGameUpdateInput,
  ): Promise<AdminGameResponse> {
    const { game } = await this.gameContext(admin, gameId);
    const [updated] = await this.dbService.db
      .update(games)
      .set({
        name: input.name ?? game.name,
        cabinetLabel: input.cabinetLabel === undefined ? game.cabinetLabel : input.cabinetLabel,
        boardMode: input.boardMode ?? game.boardMode,
        maxQueueLen: input.maxQueueLen === undefined ? game.maxQueueLen : input.maxQueueLen,
        isActive: input.isActive ?? game.isActive,
      })
      .where(eq(games.id, gameId))
      .returning();
    if (!updated) {
      throw new NotFoundException({ code: 'game_not_found', message: 'Game not found.' });
    }
    this.publishForGame(updated);
    return this.toGameResponse(updated, null);
  }

  async deleteGame(admin: AuthenticatedAdmin, gameId: string): Promise<void> {
    const { game } = await this.gameContext(admin, gameId);
    await this.dbService.db.delete(games).where(eq(games.id, gameId));
    this.publishForGame(game);
  }

  async reorderGames(admin: AuthenticatedAdmin, locationId: string, order: string[]): Promise<void> {
    await this.assertLocationAccess(admin, locationId);
    const existing = await this.dbService.db
      .select({ id: games.id })
      .from(games)
      .where(eq(games.locationId, locationId));
    const known = new Set(existing.map((row) => row.id));
    if (order.length !== known.size || !order.every((id) => known.has(id))) {
      throw new BadRequestException({
        code: 'invalid_reorder',
        message: 'Reorder must list every game in this location exactly once.',
      });
    }
    await this.dbService.db.transaction(async (tx) => {
      for (let index = 0; index < order.length; index += 1) {
        await tx
          .update(games)
          .set({ sortOrder: (index + 1) * 10 })
          .where(eq(games.id, order[index]!));
      }
    });
  }

  async setCommunityNote(
    admin: AuthenticatedAdmin,
    gameId: string,
    input: AdminCommunityNoteInput,
  ): Promise<AdminGameResponse> {
    await this.gameContext(admin, gameId);
    const body = input.body.trim();
    const [updated] = await this.dbService.db
      .update(games)
      .set({
        communityNote: body.length > 0 ? body : null,
        communityNoteVisible: input.visible && body.length > 0,
        communityNoteUpdatedAt: new Date(),
        communityNoteUpdatedBy: admin.user.id,
      })
      .where(eq(games.id, gameId))
      .returning();
    if (!updated) {
      throw new NotFoundException({ code: 'game_not_found', message: 'Game not found.' });
    }
    this.publishForGame(updated);
    return this.toGameResponse(updated, admin.user.email);
  }

  // -------------------------------------------------------------------------
  // Live queue
  // -------------------------------------------------------------------------

  /** Throws if the game is missing or the operator lacks a grant — used to gate the SSE stream. */
  async assertGameAccessible(admin: AuthenticatedAdmin, gameId: string): Promise<void> {
    await this.gameContext(admin, gameId);
  }

  async queueBoard(admin: AuthenticatedAdmin, gameId: string): Promise<AdminQueueBoardResponse> {
    const { game, location } = await this.gameContext(admin, gameId);
    const serviceDate = this.serviceDateService.current(location.timezone);
    const rows = await this.dbService.db
      .select()
      .from(queueEntries)
      .where(and(eq(queueEntries.gameId, gameId), eq(queueEntries.serviceDate, serviceDate)))
      .orderBy(asc(queueEntries.ticketNumber));
    const rounds = computeRounds(rows);

    return {
      game: { id: game.id, name: game.name, cabinetLabel: game.cabinetLabel },
      locationId: location.id,
      serviceDate,
      locationTimezone: location.timezone,
      boardMode: game.boardMode,
      entries: rows.map((entry) => toQueueEntryResponse(entry, undefined, rounds.get(entry.id) ?? 1)),
    };
  }

  async markEntryDone(admin: AuthenticatedAdmin, entryId: string, reason: DoneReason): Promise<void> {
    const entry = await this.entryForAdmin(admin, entryId);
    if (entry.status !== 'waiting') {
      throw new ConflictException({ code: 'entry_already_done', message: 'Entry is already done.' });
    }
    await this.dbService.db
      .update(queueEntries)
      .set({ status: 'done', doneReason: reason, doneAt: new Date(), doneByRole: 'admin', doneByName: null })
      .where(eq(queueEntries.id, entryId));
    this.publishForEntry(entry);
  }

  async deleteEntry(admin: AuthenticatedAdmin, entryId: string): Promise<void> {
    const entry = await this.entryForAdmin(admin, entryId);
    await this.dbService.db.delete(queueEntries).where(eq(queueEntries.id, entryId));
    this.publishForEntry(entry);
  }

  async clearQueue(admin: AuthenticatedAdmin, gameId: string): Promise<number> {
    const { location } = await this.gameContext(admin, gameId);
    const serviceDate = this.serviceDateService.current(location.timezone);
    const removed = await this.dbService.db
      .delete(queueEntries)
      .where(and(eq(queueEntries.gameId, gameId), eq(queueEntries.serviceDate, serviceDate)))
      .returning({ id: queueEntries.id });
    this.queueEventsService.publishQueueUpdated({
      gameId,
      locationId: location.id,
      serviceDate,
    });
    return removed.length;
  }

  private async entryForAdmin(
    admin: AuthenticatedAdmin,
    entryId: string,
  ): Promise<typeof queueEntries.$inferSelect> {
    const [entry] = await this.dbService.db
      .select()
      .from(queueEntries)
      .where(eq(queueEntries.id, entryId))
      .limit(1);
    if (!entry) {
      throw new NotFoundException({ code: 'queue_entry_not_found', message: 'Queue entry not found.' });
    }
    await this.assertLocationAccess(admin, entry.locationId);
    return entry;
  }

  // -------------------------------------------------------------------------
  // Admin users & grants (superadmin only — gated at the controller)
  // -------------------------------------------------------------------------

  async listUsers(): Promise<AdminUserResponse[]> {
    const users = await this.dbService.db.select().from(adminUsers).orderBy(asc(adminUsers.email));
    const grants = await this.dbService.db.select().from(adminLocationGrants);
    const grantsByUser = new Map<string, string[]>();
    for (const grant of grants) {
      const list = grantsByUser.get(grant.adminUserId) ?? [];
      list.push(grant.locationId);
      grantsByUser.set(grant.adminUserId, list);
    }
    return users.map((user) => this.toUserResponse(user, grantsByUser.get(user.id) ?? []));
  }

  async createUser(input: AdminUserCreateInput): Promise<AdminUserResponse> {
    const [existing] = await this.dbService.db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.email, input.email))
      .limit(1);
    if (existing) {
      throw new ConflictException({ code: 'email_taken', message: 'That email is already in use.' });
    }
    const passwordHash = await this.authService.hashPassword(input.password);
    const userId = uuidv7();
    await this.dbService.db.transaction(async (tx) => {
      await tx
        .insert(adminUsers)
        .values({ id: userId, email: input.email, passwordHash, role: input.role });
      const grantIds = input.role === 'operator' ? input.grantedLocationIds : [];
      if (grantIds.length > 0) {
        await tx
          .insert(adminLocationGrants)
          .values(grantIds.map((locationId) => ({ adminUserId: userId, locationId })));
      }
    });
    const grants = await this.grantedLocationIds(userId);
    const [created] = await this.dbService.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, userId))
      .limit(1);
    return this.toUserResponse(created!, grants);
  }

  async updateUser(
    actingUserId: string,
    userId: string,
    input: AdminUserUpdateInput,
  ): Promise<AdminUserResponse> {
    const target = await this.findUser(userId);

    // Safety: you cannot lock yourself or the platform out of superadmin access.
    if (userId === actingUserId && (input.isActive === false || input.role === 'operator')) {
      throw new BadRequestException({
        code: 'cannot_demote_self',
        message: 'You cannot deactivate or demote your own account.',
      });
    }
    const losesSuperadmin =
      target.role === 'superadmin' && (input.role === 'operator' || input.isActive === false);
    if (losesSuperadmin && (await this.activeSuperadminCount()) <= 1) {
      throw new BadRequestException({
        code: 'last_superadmin',
        message: 'At least one active superadmin must remain.',
      });
    }

    await this.dbService.db
      .update(adminUsers)
      .set({
        role: input.role ?? target.role,
        isActive: input.isActive ?? target.isActive,
      })
      .where(eq(adminUsers.id, userId));

    if (input.isActive === false) {
      await this.sessionService.revokeAllForUser(userId);
    }
    // Promoting to superadmin makes location grants meaningless; clear them.
    if (input.role === 'superadmin') {
      await this.dbService.db
        .delete(adminLocationGrants)
        .where(eq(adminLocationGrants.adminUserId, userId));
    }
    const grants = await this.grantedLocationIds(userId);
    const updated = await this.findUser(userId);
    return this.toUserResponse(updated, grants);
  }

  async setGrants(userId: string, locationIds: string[]): Promise<AdminUserResponse> {
    const target = await this.findUser(userId);
    if (target.role !== 'operator') {
      throw new BadRequestException({
        code: 'grants_superadmin',
        message: 'Superadmins already have access to every location.',
      });
    }
    const unique = [...new Set(locationIds)];
    if (unique.length > 0) {
      const found = await this.dbService.db
        .select({ id: locations.id })
        .from(locations)
        .where(inArray(locations.id, unique));
      if (found.length !== unique.length) {
        throw new BadRequestException({
          code: 'unknown_location',
          message: 'One or more locations do not exist.',
        });
      }
    }
    await this.dbService.db.transaction(async (tx) => {
      await tx.delete(adminLocationGrants).where(eq(adminLocationGrants.adminUserId, userId));
      if (unique.length > 0) {
        await tx
          .insert(adminLocationGrants)
          .values(unique.map((locationId) => ({ adminUserId: userId, locationId })));
      }
    });
    return this.toUserResponse(target, unique);
  }

  async setPassword(userId: string, password: string): Promise<void> {
    await this.findUser(userId);
    const passwordHash = await this.authService.hashPassword(password);
    await this.dbService.db
      .update(adminUsers)
      .set({ passwordHash })
      .where(eq(adminUsers.id, userId));
    await this.sessionService.revokeAllForUser(userId);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async findLocation(locationId: string): Promise<typeof locations.$inferSelect> {
    const [location] = await this.dbService.db
      .select()
      .from(locations)
      .where(eq(locations.id, locationId))
      .limit(1);
    if (!location) {
      throw new NotFoundException({ code: 'location_not_found', message: 'Location not found.' });
    }
    return location;
  }

  private async findUser(userId: string): Promise<typeof adminUsers.$inferSelect> {
    const [user] = await this.dbService.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, userId))
      .limit(1);
    if (!user) {
      throw new NotFoundException({ code: 'admin_user_not_found', message: 'Admin user not found.' });
    }
    return user;
  }

  private async activeSuperadminCount(): Promise<number> {
    const [row] = await this.dbService.db
      .select({ value: sql<number>`count(*)`.mapWith(Number) })
      .from(adminUsers)
      .where(and(eq(adminUsers.role, 'superadmin'), eq(adminUsers.isActive, true)));
    return row?.value ?? 0;
  }

  private async assertSlugFree(slug: string, excludeId: string | null): Promise<void> {
    if (!(await this.slugAvailable(slug, excludeId ?? undefined))) {
      throw new ConflictException({ code: 'slug_taken', message: 'That slug is already in use.' });
    }
  }

  private publishForGame(game: typeof games.$inferSelect): void {
    void this.publishForGameAsync(game);
  }

  private async publishForGameAsync(game: typeof games.$inferSelect): Promise<void> {
    const location = await this.findLocation(game.locationId);
    this.queueEventsService.publishQueueUpdated({
      gameId: game.id,
      locationId: game.locationId,
      serviceDate: this.serviceDateService.current(location.timezone),
    });
  }

  private publishForEntry(entry: typeof queueEntries.$inferSelect): void {
    void this.publishForGameAsync({ id: entry.gameId, locationId: entry.locationId } as typeof games.$inferSelect);
  }

  private toLocationResponse(row: {
    id: string;
    slug: string;
    name: string;
    address: string | null;
    timezone: string;
    isActive: boolean;
    requireApprovalForOthers: boolean;
    staffPinHash: string | null;
    gameCount: number;
  }): AdminLocationResponse {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      address: row.address,
      timezone: row.timezone,
      isActive: row.isActive,
      requireApprovalForOthers: row.requireApprovalForOthers,
      hasStaffPin: row.staffPinHash !== null,
      gameCount: row.gameCount,
    };
  }

  private toGameResponse(
    game: typeof games.$inferSelect,
    editorEmail: string | null,
  ): AdminGameResponse {
    return {
      id: game.id,
      locationId: game.locationId,
      name: game.name,
      cabinetLabel: game.cabinetLabel,
      queueStrategy: game.queueStrategy,
      boardMode: game.boardMode,
      maxQueueLen: game.maxQueueLen,
      isActive: game.isActive,
      sortOrder: game.sortOrder,
      communityNote: game.communityNote,
      communityNoteVisible: game.communityNoteVisible,
      communityNoteUpdatedAt: game.communityNoteUpdatedAt?.toISOString() ?? null,
      communityNoteUpdatedByName: editorEmail,
    };
  }

  private toUserResponse(
    user: typeof adminUsers.$inferSelect,
    grantedLocationIds: string[],
  ): AdminUserResponse {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
      grantedLocationIds,
    };
  }
}

function computeRounds(entries: Array<typeof queueEntries.$inferSelect>): Map<string, number> {
  const parents = new Map(entries.map((entry) => [entry.id, entry.requeuedFrom]));
  const rounds = new Map<string, number>();
  for (const entry of entries) {
    let round = 1;
    let parentId = entry.requeuedFrom;
    const visited = new Set([entry.id]);
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      round += 1;
      parentId = parents.get(parentId) ?? null;
    }
    rounds.set(entry.id, round);
  }
  return rounds;
}
