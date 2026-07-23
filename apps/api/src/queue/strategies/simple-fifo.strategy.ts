import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import argon2 from 'argon2';
import {
  completeQueueEntryResponseSchema,
  enqueueResponseSchema,
  type CompleteQueueEntryResponse,
  type EnqueueResponse,
  type QueueScope,
} from '@machi2/shared';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { PublicWriteRateLimiterService } from '../../common/public-write-rate-limiter.service';
import { getEnvironment } from '../../config/environment';
import { DbService } from '../../db/db.service';
import { idempotencyRecords, queueEntries } from '../../db/schema';
import type { QueueContext } from '../../locations/locations.service';
import { toQueueEntryResponse } from '../queue-entry.presenter';
import type { CompleteInput, EnqueueInput, QueueStrategy } from './queue-strategy.interface';

@Injectable()
export class SimpleFifoStrategy implements QueueStrategy {
  readonly key = 'simple_fifo';

  constructor(
    private readonly dbService: DbService,
    private readonly rateLimiter: PublicWriteRateLimiterService,
  ) {}

  async enqueue(context: QueueContext, input: EnqueueInput): Promise<EnqueueResponse> {
    const scope = `enqueue:${context.game.id}:${context.serviceDate}`;

    return this.dbService.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ responseJson: idempotencyRecords.responseJson })
        .from(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.scope, scope),
            eq(idempotencyRecords.key, input.idempotencyKey),
          ),
        )
        .limit(1);

      if (existing) {
        return enqueueResponseSchema.parse(existing.responseJson);
      }

      const [reservation] = await tx
        .insert(idempotencyRecords)
        .values({
          id: uuidv7(),
          scope,
          key: input.idempotencyKey,
          responseJson: {},
        })
        .onConflictDoNothing()
        .returning({ id: idempotencyRecords.id });

      if (!reservation) {
        const [replay] = await tx
          .select({ responseJson: idempotencyRecords.responseJson })
          .from(idempotencyRecords)
          .where(
            and(
              eq(idempotencyRecords.scope, scope),
              eq(idempotencyRecords.key, input.idempotencyKey),
            ),
          )
          .limit(1);
        if (!replay) {
          throw new ConflictException({
            code: 'idempotency_in_progress',
            message: 'The original request is still being processed.',
          });
        }
        return enqueueResponseSchema.parse(replay.responseJson);
      }

      // Per-device enqueue interval (default 1 per 5s; ENQUEUE_DEVICE_* env). The per-IP
      // tier (ENQUEUE_IP_* in the controller) and the re-join cooldown are the other
      // queue-manipulation guards.
      const env = getEnvironment();
      this.rateLimiter.assertForActor(
        'enqueue',
        input.actor,
        env.enqueueDeviceLimit,
        env.enqueueDeviceTtlMs,
      );
      this.assertGameIsAvailable(context);
      await this.lockQueue(tx, context);

      const [activeEntry] = await tx
        .select({ id: queueEntries.id })
        .from(queueEntries)
        .where(
          and(
            eq(queueEntries.gameId, context.game.id),
            eq(queueEntries.serviceDate, context.serviceDate),
            eq(queueEntries.deviceTokenHash, input.actor.deviceTokenHash),
            eq(queueEntries.status, 'waiting'),
          ),
        )
        .limit(1);
      if (activeEntry) {
        throw new ConflictException({
          code: 'already_in_queue',
          message: 'This device already has an active entry for this game.',
        });
      }

      await this.assertManualCooldown(tx, context, input.actor.deviceTokenHash);
      await this.assertQueueCapacity(tx, context);
      const ticketNumber = await this.nextTicketNumber(tx, context);
      const [entry] = await tx
        .insert(queueEntries)
        .values({
          id: uuidv7(),
          gameId: context.game.id,
          locationId: context.location.id,
          serviceDate: context.serviceDate,
          ticketNumber,
          displayName: input.displayName,
          autoRequeue: input.autoRequeue,
          deviceTokenHash: input.actor.deviceTokenHash,
          ipHash: input.actor.ipHash,
          idempotencyKey: input.idempotencyKey,
        })
        .returning();

      if (!entry) {
        throw new ConflictException({
          code: 'enqueue_failed',
          message: 'Queue entry could not be created.',
        });
      }

      const response: EnqueueResponse = {
        entry: toQueueEntryResponse(entry, input.actor.deviceTokenHash, 1),
      };
      await tx
        .update(idempotencyRecords)
        .set({ responseJson: response })
        .where(eq(idempotencyRecords.id, reservation.id));

      return response;
    });
  }

  async complete(
    context: QueueContext,
    entryId: string,
    input: CompleteInput,
  ): Promise<CompleteQueueEntryResponse> {
    const scope = `complete:${entryId}`;

    return this.dbService.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ responseJson: idempotencyRecords.responseJson })
        .from(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.scope, scope),
            eq(idempotencyRecords.key, input.idempotencyKey),
          ),
        )
        .limit(1);

      if (existing) {
        return completeQueueEntryResponseSchema.parse(existing.responseJson);
      }

      const [reservation] = await tx
        .insert(idempotencyRecords)
        .values({
          id: uuidv7(),
          scope,
          key: input.idempotencyKey,
          responseJson: {},
        })
        .onConflictDoNothing()
        .returning({ id: idempotencyRecords.id });

      if (!reservation) {
        const [replay] = await tx
          .select({ responseJson: idempotencyRecords.responseJson })
          .from(idempotencyRecords)
          .where(
            and(
              eq(idempotencyRecords.scope, scope),
              eq(idempotencyRecords.key, input.idempotencyKey),
            ),
          )
          .limit(1);
        if (!replay) {
          throw new ConflictException({
            code: 'idempotency_in_progress',
            message: 'The original request is still being processed.',
          });
        }
        return completeQueueEntryResponseSchema.parse(replay.responseJson);
      }

      this.rateLimiter.assertForActor('complete', input.actor, 10, 60_000);
      await this.lockEntry(tx, entryId);
      const [entry] = await tx
        .select()
        .from(queueEntries)
        .where(eq(queueEntries.id, entryId))
        .limit(1);

      if (!entry) {
        throw new NotFoundException({
          code: 'queue_entry_not_found',
          message: 'Queue entry not found.',
        });
      }
      if (entry.serviceDate !== context.serviceDate) {
        throw new NotFoundException({
          code: 'queue_entry_not_current',
          message: 'Queue entry is not part of the current service day.',
        });
      }
      if (entry.status !== 'waiting') {
        throw new ConflictException({
          code: 'entry_already_done',
          message: 'Queue entry is already done.',
        });
      }

      const isOwner = entry.deviceTokenHash === input.actor.deviceTokenHash;
      const doneByRole = await this.resolveDoneByRole(context, input, isOwner);
      if (doneByRole === 'player') {
        this.rateLimiter.assertForActor('complete-other', input.actor, 3, 60_000);
      }
      const [completedEntry] = await tx
        .update(queueEntries)
        .set({
          status: 'done',
          doneReason: input.reason,
          doneAt: new Date(),
          doneByTokenHash: input.actor.deviceTokenHash,
          doneByName: input.actingName ?? null,
          doneByRole,
        })
        .where(eq(queueEntries.id, entry.id))
        .returning();

      if (!completedEntry) {
        throw new ConflictException({
          code: 'completion_failed',
          message: 'Queue entry could not be completed.',
        });
      }

      const roundNumber = await this.roundNumber(tx, completedEntry);
      let requeuedEntry: typeof queueEntries.$inferSelect | null = null;
      let autoRequeueSkipped = false;
      if (completedEntry.autoRequeue && input.reason === 'played') {
        await this.lockQueue(tx, context);
        const waitingCount = await this.waitingCount(tx, context);
        if (context.game.maxQueueLen !== null && waitingCount >= context.game.maxQueueLen) {
          autoRequeueSkipped = true;
        } else {
          const ticketNumber = await this.nextTicketNumber(tx, context);
          const [inserted] = await tx
            .insert(queueEntries)
            .values({
              id: uuidv7(),
              gameId: completedEntry.gameId,
              locationId: completedEntry.locationId,
              serviceDate: completedEntry.serviceDate,
              ticketNumber,
              displayName: completedEntry.displayName,
              autoRequeue: true,
              requeuedFrom: completedEntry.id,
              deviceTokenHash: completedEntry.deviceTokenHash,
              ipHash: completedEntry.ipHash,
            })
            .returning();
          requeuedEntry = inserted ?? null;
        }
      }

      const response: CompleteQueueEntryResponse = {
        entry: toQueueEntryResponse(completedEntry, input.actor.deviceTokenHash, roundNumber),
        requeuedEntry: requeuedEntry
          ? toQueueEntryResponse(requeuedEntry, input.actor.deviceTokenHash, roundNumber + 1)
          : null,
        autoRequeueSkipped,
      };
      await tx
        .update(idempotencyRecords)
        .set({ responseJson: response })
        .where(eq(idempotencyRecords.id, reservation.id));

      return response;
    });
  }

  async list(
    context: QueueContext,
    scope: QueueScope,
  ): Promise<Array<typeof queueEntries.$inferSelect>> {
    const query = this.dbService.db
      .select()
      .from(queueEntries)
      .where(
        and(
          eq(queueEntries.gameId, context.game.id),
          eq(queueEntries.serviceDate, context.serviceDate),
        ),
      );

    if (scope === 'all') {
      return query.orderBy(queueEntries.ticketNumber);
    }

    const recent = await query.orderBy(desc(queueEntries.ticketNumber)).limit(10);
    return recent.reverse();
  }

  private assertGameIsAvailable(context: QueueContext): void {
    if (!context.location.isActive || !context.game.isActive) {
      throw new ConflictException({
        code: 'game_unavailable',
        message: 'This game is not accepting queue entries.',
      });
    }
  }

  private async resolveDoneByRole(
    context: QueueContext,
    input: CompleteInput,
    isOwner: boolean,
  ): Promise<'self' | 'player' | 'staff'> {
    if (!input.actingName && !input.staffPin) {
      throw new BadRequestException({
        code: 'acting_name_required',
        message: 'Acting name is required unless a staff PIN is provided.',
      });
    }

    if (isOwner) {
      return 'self';
    }
    if (!context.location.requireApprovalForOthers) {
      return 'player';
    }
    if (!input.staffPin || !context.location.staffPinHash) {
      throw new ForbiddenException({
        code: 'staff_approval_required',
        message: 'A valid staff PIN is required to complete another player’s entry.',
      });
    }

    const isValidPin = await argon2.verify(context.location.staffPinHash, input.staffPin);
    if (!isValidPin) {
      throw new ForbiddenException({ code: 'invalid_staff_pin', message: 'Staff PIN is invalid.' });
    }

    return 'staff';
  }

  private async assertManualCooldown(
    tx: Parameters<typeof this.dbService.db.transaction>[0] extends (
      transaction: infer Transaction,
    ) => Promise<unknown>
      ? Transaction
      : never,
    context: QueueContext,
    deviceTokenHash: string,
  ): Promise<void> {
    const cooldownSeconds = getEnvironment().rejoinCooldownSeconds;
    if (cooldownSeconds === 0) {
      return;
    }

    const [recentCompletion] = await tx
      .select({ id: queueEntries.id })
      .from(queueEntries)
      .where(
        and(
          eq(queueEntries.gameId, context.game.id),
          eq(queueEntries.serviceDate, context.serviceDate),
          eq(queueEntries.deviceTokenHash, deviceTokenHash),
          eq(queueEntries.status, 'done'),
          gt(queueEntries.doneAt, new Date(Date.now() - cooldownSeconds * 1_000)),
        ),
      )
      .limit(1);

    if (recentCompletion) {
      throw new ConflictException({
        code: 'rejoin_cooldown',
        message: 'Please wait before rejoining this queue.',
      });
    }
  }

  private async assertQueueCapacity(
    tx: Parameters<typeof this.dbService.db.transaction>[0] extends (
      transaction: infer Transaction,
    ) => Promise<unknown>
      ? Transaction
      : never,
    context: QueueContext,
  ): Promise<void> {
    if (context.game.maxQueueLen === null) {
      return;
    }
    const waitingCount = await this.waitingCount(tx, context);
    if (waitingCount >= context.game.maxQueueLen) {
      throw new ConflictException({ code: 'queue_full', message: 'This queue is full.' });
    }
  }

  private async waitingCount(
    tx: Parameters<typeof this.dbService.db.transaction>[0] extends (
      transaction: infer Transaction,
    ) => Promise<unknown>
      ? Transaction
      : never,
    context: QueueContext,
  ): Promise<number> {
    const [result] = await tx
      .select({ value: sql<number>`count(*)`.mapWith(Number) })
      .from(queueEntries)
      .where(
        and(
          eq(queueEntries.gameId, context.game.id),
          eq(queueEntries.serviceDate, context.serviceDate),
          eq(queueEntries.status, 'waiting'),
        ),
      );
    return result?.value ?? 0;
  }

  private async nextTicketNumber(
    tx: Parameters<typeof this.dbService.db.transaction>[0] extends (
      transaction: infer Transaction,
    ) => Promise<unknown>
      ? Transaction
      : never,
    context: QueueContext,
  ): Promise<number> {
    const [result] = await tx
      .select({
        value: sql<number>`coalesce(max(${queueEntries.ticketNumber}), 0) + 1`.mapWith(Number),
      })
      .from(queueEntries)
      .where(
        and(
          eq(queueEntries.gameId, context.game.id),
          eq(queueEntries.serviceDate, context.serviceDate),
        ),
      );
    return result?.value ?? 1;
  }

  private async lockQueue(
    tx: Parameters<typeof this.dbService.db.transaction>[0] extends (
      transaction: infer Transaction,
    ) => Promise<unknown>
      ? Transaction
      : never,
    context: QueueContext,
  ): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${context.game.id}:${context.serviceDate}`}, 0))`,
    );
  }

  private async lockEntry(
    tx: Parameters<typeof this.dbService.db.transaction>[0] extends (
      transaction: infer Transaction,
    ) => Promise<unknown>
      ? Transaction
      : never,
    entryId: string,
  ): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${entryId}, 0))`);
  }

  private async roundNumber(
    tx: Parameters<typeof this.dbService.db.transaction>[0] extends (
      transaction: infer Transaction,
    ) => Promise<unknown>
      ? Transaction
      : never,
    entry: typeof queueEntries.$inferSelect,
  ): Promise<number> {
    let round = 1;
    let previousId = entry.requeuedFrom;
    const visited = new Set([entry.id]);

    while (previousId && !visited.has(previousId)) {
      visited.add(previousId);
      const [previous] = await tx
        .select({ id: queueEntries.id, requeuedFrom: queueEntries.requeuedFrom })
        .from(queueEntries)
        .where(eq(queueEntries.id, previousId))
        .limit(1);
      if (!previous) {
        break;
      }
      round += 1;
      previousId = previous.requeuedFrom;
    }

    return round;
  }
}
