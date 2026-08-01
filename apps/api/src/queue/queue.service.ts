import { Injectable } from '@nestjs/common';
import type {
  CompleteQueueEntryResponse,
  EnqueueResponse,
  LocationPosition,
  QueueBoardResponse,
  QueueScope,
} from '@machi2/shared';
import { MAX_LOCATION_ACCURACY_METERS } from '@machi2/shared';
import { and, eq } from 'drizzle-orm';

import type { DeviceActor } from '../common/device-token.service';
import { DbService } from '../db/db.service';
import { queueEntries } from '../db/schema';
import { LocationsService, type QueueContext } from '../locations/locations.service';
import { toQueueEntryResponse } from './queue-entry.presenter';
import { QueueEventsService } from './queue-events.service';
import { QueueStrategyRegistry } from './strategies/queue-strategy.registry';

@Injectable()
export class QueueService {
  constructor(
    private readonly dbService: DbService,
    private readonly locationsService: LocationsService,
    private readonly strategyRegistry: QueueStrategyRegistry,
    private readonly queueEventsService: QueueEventsService,
  ) {}

  async enqueue(
    gameId: string,
    input: { displayName: string; autoRequeue: boolean; position?: LocationPosition },
    actor: DeviceActor,
    idempotencyKey: string,
  ): Promise<EnqueueResponse> {
    const context = await this.locationsService.getQueueContext(gameId);
    const strategy = this.strategyRegistry.resolve(context.game.queueStrategy);
    const response = await strategy.enqueue(context, { ...input, actor, idempotencyKey });
    this.queueEventsService.publishQueueUpdated({
      gameId: context.game.id,
      locationId: context.location.id,
      serviceDate: context.serviceDate,
    });
    return response;
  }

  async complete(
    entryId: string,
    input: {
      reason: 'played' | 'left' | 'skipped' | 'other';
      actingName?: string;
      staffPin?: string;
      position?: LocationPosition;
    },
    actor: DeviceActor,
    idempotencyKey: string,
  ): Promise<CompleteQueueEntryResponse> {
    const context = await this.locationsService.getContextForEntry(entryId);
    const strategy = this.strategyRegistry.resolve(context.game.queueStrategy);
    const response = await strategy.complete(context, entryId, { ...input, actor, idempotencyKey });
    this.queueEventsService.publishQueueUpdated({
      gameId: context.game.id,
      locationId: context.location.id,
      serviceDate: context.serviceDate,
    });
    return response;
  }

  async board(
    gameId: string,
    scope: QueueScope,
    actorTokenHash: string | undefined,
  ): Promise<QueueBoardResponse> {
    const context = await this.locationsService.getQueueContext(gameId);
    const strategy = this.strategyRegistry.resolve(context.game.queueStrategy);
    const entries = await strategy.list(context, scope);
    const roundNumbers = await this.roundNumbers(context);

    return {
      game: {
        id: context.game.id,
        name: context.game.name,
        cabinetLabel: context.game.cabinetLabel,
      },
      serviceDate: context.serviceDate,
      locationTimezone: context.location.timezone,
      boardMode: context.game.boardMode,
      requireApprovalForOthers: context.location.requireApprovalForOthers,
      locationValidation:
        context.location.latitude === null || context.location.longitude === null
          ? { required: false }
          : {
              required: true,
              latitude: context.location.latitude,
              longitude: context.location.longitude,
              radiusMeters: context.location.locationValidationRadiusMeters,
              maxAccuracyMeters: MAX_LOCATION_ACCURACY_METERS,
            },
      communityNote:
        context.game.communityNoteVisible && context.game.communityNote
          ? {
              body: context.game.communityNote,
              updatedAt: context.game.communityNoteUpdatedAt?.toISOString() ?? null,
            }
          : null,
      entries: entries.map((entry) =>
        toQueueEntryResponse(entry, actorTokenHash, roundNumbers.get(entry.id) ?? 1),
      ),
    };
  }

  async assertGameExists(gameId: string): Promise<void> {
    await this.locationsService.getQueueContext(gameId);
  }

  private async roundNumbers(context: QueueContext): Promise<Map<string, number>> {
    const entries = await this.dbService.db
      .select({ id: queueEntries.id, requeuedFrom: queueEntries.requeuedFrom })
      .from(queueEntries)
      .where(
        and(
          eq(queueEntries.gameId, context.game.id),
          eq(queueEntries.serviceDate, context.serviceDate),
        ),
      );
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
}
