import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  completeQueueEntryResponseSchema,
  enqueueResponseSchema,
  queueBoardResponseSchema,
} from '@machi2/shared';
import { eq, like } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';
import { DbService } from '../db/db.service';
import { games, idempotencyRecords, locations, queueEntries } from '../db/schema';
import { QueueService } from '../queue/queue.service';

describe('public queue API', () => {
  let app: NestFastifyApplication;
  let dbService: DbService;
  let queueService: QueueService;
  let gameId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    dbService = app.get(DbService);
    queueService = app.get(QueueService);

    const [location] = await dbService.db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.slug, 'machi-local'))
      .limit(1);
    if (!location) {
      throw new Error('Expected local development seed to exist.');
    }

    gameId = uuidv7();
    await dbService.db.insert(games).values({
      id: gameId,
      locationId: location.id,
      name: 'Integration Queue',
      cabinetLabel: `Test ${gameId.slice(-6)}`,
      maxQueueLen: 20,
      sortOrder: 9_999,
    });
  });

  beforeEach(async () => {
    await dbService.db.delete(queueEntries).where(eq(queueEntries.gameId, gameId));
    await dbService.db
      .delete(idempotencyRecords)
      .where(like(idempotencyRecords.scope, `enqueue:${gameId}:%`));
  });

  afterAll(async () => {
    await dbService.db.delete(queueEntries).where(eq(queueEntries.gameId, gameId));
    await dbService.db
      .delete(idempotencyRecords)
      .where(like(idempotencyRecords.scope, `enqueue:${gameId}:%`));
    await dbService.db.delete(games).where(eq(games.id, gameId));
    await app.close();
  });

  it('reports healthy when Postgres is reachable', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('lists seeded locations and exposes a location-local waiting count', async () => {
    const locationsResponse = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/api/locations',
    });
    const locationDetail = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/api/locations/machi-local',
    });

    expect(locationsResponse.statusCode).toBe(200);
    expect(locationsResponse.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ slug: 'machi-local' })]),
    );
    expect(locationDetail.statusCode).toBe(200);
    expect(locationDetail.json()).toEqual(
      expect.objectContaining({
        games: expect.arrayContaining([expect.objectContaining({ id: gameId, waitingCount: 0 })]),
      }),
    );
  });

  it('replays an enqueue idempotency key without duplicating a ticket', async () => {
    const deviceToken = '018f84a3-d031-75d4-b052-ba7792225d56';
    const idempotencyKey = uuidv7();
    const request = {
      method: 'POST' as const,
      url: `/api/games/${gameId}/queue`,
      headers: {
        'content-type': 'application/json',
        'x-device-token': deviceToken,
        'idempotency-key': idempotencyKey,
      },
      payload: { displayName: '小明', autoRequeue: true },
    };

    const first = await app.getHttpAdapter().getInstance().inject(request);
    const proof = first.headers['x-device-proof'];
    const replay = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        ...request,
        headers: { ...request.headers, 'x-device-proof': proof },
      });
    const firstBody = enqueueResponseSchema.parse(first.json() as unknown);
    const replayBody = enqueueResponseSchema.parse(replay.json() as unknown);
    const board = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: `/api/games/${gameId}/queue?scope=all`,
        headers: { 'x-device-token': deviceToken },
      });
    const boardBody = queueBoardResponseSchema.parse(board.json() as unknown);

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(typeof proof).toBe('string');
    expect(replayBody).toEqual(firstBody);
    expect(boardBody.entries).toHaveLength(1);
    expect(boardBody.entries[0]).toMatchObject({
      id: firstBody.entry.id,
      ticketNumber: 1,
      mine: true,
      autoRequeue: true,
    });
  });

  it('completes a played entry and puts an auto-requeue entry at the back', async () => {
    const deviceToken = '018f84a3-d032-75d4-b052-ba7792225d56';
    const enqueue = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/api/games/${gameId}/queue`,
        headers: {
          'content-type': 'application/json',
          'x-device-token': deviceToken,
          'idempotency-key': uuidv7(),
        },
        payload: { displayName: 'Aka', autoRequeue: true },
      });
    const enqueued = enqueueResponseSchema.parse(enqueue.json() as unknown);
    const completionRequest = {
      method: 'POST',
      url: `/api/queue-entries/${enqueued.entry.id}/done`,
      headers: {
        'content-type': 'application/json',
        'x-device-token': deviceToken,
        'idempotency-key': uuidv7(),
      },
      payload: { reason: 'played', actingName: 'Aka' },
    } as const;
    const completion = await app.getHttpAdapter().getInstance().inject(completionRequest);
    const replay = await app.getHttpAdapter().getInstance().inject(completionRequest);
    const completionBody = completeQueueEntryResponseSchema.parse(completion.json() as unknown);
    const replayBody = completeQueueEntryResponseSchema.parse(replay.json() as unknown);

    expect(completion.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replayBody).toEqual(completionBody);
    expect(completionBody.entry).toMatchObject({ status: 'done', doneReason: 'played' });
    expect(completionBody.requeuedEntry).toMatchObject({
      status: 'waiting',
      ticketNumber: 2,
      roundNumber: 2,
      autoRequeue: true,
    });
    expect(completionBody.autoRequeueSkipped).toBe(false);
  });

  it('keeps prior service-date entries out of the public board', async () => {
    const [game] = await dbService.db
      .select({ locationId: games.locationId })
      .from(games)
      .where(eq(games.id, gameId))
      .limit(1);
    if (!game) {
      throw new Error('Expected integration game to exist.');
    }

    await dbService.db.insert(queueEntries).values({
      id: uuidv7(),
      gameId,
      locationId: game.locationId,
      serviceDate: '2000-01-01',
      ticketNumber: 1,
      displayName: 'Past',
      deviceTokenHash: 'past-device',
      ipHash: 'past-ip',
    });

    const board = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: `/api/games/${gameId}/queue?scope=all`,
      });
    const boardBody = queueBoardResponseSchema.parse(board.json() as unknown);

    expect(board.statusCode).toBe(200);
    expect(boardBody.entries).toHaveLength(0);
  });

  it('allocates sequential tickets under concurrent enqueue', async () => {
    const requests = Array.from({ length: 6 }, (_, index) =>
      queueService.enqueue(
        gameId,
        { displayName: `P${index}`, autoRequeue: false },
        {
          deviceTokenHash: `device-${index}`,
          deviceProof: `proof-${index}`,
          ipHash: `ip-${index}`,
        },
        uuidv7(),
      ),
    );

    const results = await Promise.all(requests);

    expect(results.map((result) => result.entry.ticketNumber).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });
});
