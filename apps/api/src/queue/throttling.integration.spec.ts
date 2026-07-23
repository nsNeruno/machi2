import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { eq, like, or } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';
import { ServiceDateService } from '../common/service-date.service';
import { DbService } from '../db/db.service';
import { games, idempotencyRecords, locations, queueEntries } from '../db/schema';
import { QueueService } from './queue.service';

describe('public queue throttling and domain limits', () => {
  let app: NestFastifyApplication;
  let dbService: DbService;
  let queueService: QueueService;
  let serviceDateService: ServiceDateService;
  let gameId: string;
  let locationId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    dbService = app.get(DbService);
    queueService = app.get(QueueService);
    serviceDateService = app.get(ServiceDateService);

    const [location] = await dbService.db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.slug, 'machi-local'))
      .limit(1);
    if (!location) {
      throw new Error('Expected local development seed to exist.');
    }
    locationId = location.id;
    gameId = uuidv7();
    await dbService.db.insert(games).values({
      id: gameId,
      locationId,
      name: 'Throttle Integration Queue',
      cabinetLabel: `M3 ${gameId.slice(-6)}`,
      maxQueueLen: 20,
      sortOrder: 9_998,
    });
  });

  beforeEach(async () => {
    await dbService.db.delete(queueEntries).where(eq(queueEntries.gameId, gameId));
    await dbService.db
      .delete(idempotencyRecords)
      .where(
        or(
          like(idempotencyRecords.scope, `enqueue:${gameId}:%`),
          like(idempotencyRecords.scope, `complete:%`),
        ),
      );
    await dbService.db.update(games).set({ maxQueueLen: 20 }).where(eq(games.id, gameId));
  });

  afterAll(async () => {
    await dbService.db.delete(queueEntries).where(eq(queueEntries.gameId, gameId));
    await dbService.db
      .delete(idempotencyRecords)
      .where(like(idempotencyRecords.scope, `enqueue:${gameId}:%`));
    await dbService.db.delete(games).where(eq(games.id, gameId));
    await app.close();
  });

  it('rejects the fourth enqueue from one IP while allowing distinct devices before the boundary', async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 4; index += 1) {
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: 'POST',
          url: `/api/games/${gameId}/queue`,
          remoteAddress: '203.0.113.40',
          headers: {
            'content-type': 'application/json',
            'x-device-token': uuidv7(),
            'idempotency-key': uuidv7(),
          },
          payload: { displayName: `E${index}`, autoRequeue: false },
        });
      statuses.push(response.statusCode);
    }

    expect(statuses).toEqual([201, 201, 201, 429]);
  });

  it('keeps the completion tier independent from the enqueue tier', async () => {
    const entries = await Promise.all(
      Array.from({ length: 11 }, (_, index) =>
        queueService.enqueue(
          gameId,
          { displayName: `C${index}`, autoRequeue: false },
          {
            deviceTokenHash: `complete-device-${index}`,
            deviceProof: `complete-proof-${index}`,
            ipHash: `complete-ip-${index}`,
          },
          uuidv7(),
        ),
      ),
    );

    const statuses: number[] = [];
    for (const [index, result] of entries.entries()) {
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: 'POST',
          url: `/api/queue-entries/${result.entry.id}/done`,
          remoteAddress: '203.0.113.41',
          headers: {
            'content-type': 'application/json',
            'x-device-token': uuidv7(),
            'idempotency-key': uuidv7(),
          },
          payload: { reason: 'played', actingName: `A${index}` },
        });
      statuses.push(response.statusCode);
    }

    expect(statuses.slice(0, 10)).toEqual(Array.from({ length: 10 }, () => 201));
    expect(statuses[10]).toBe(429);
  });

  it('enforces max queue length and the manual rejoin cooldown in the domain service', async () => {
    await dbService.db.update(games).set({ maxQueueLen: 1 }).where(eq(games.id, gameId));
    await queueService.enqueue(
      gameId,
      { displayName: 'First', autoRequeue: false },
      { deviceTokenHash: 'limit-device-1', deviceProof: 'proof', ipHash: 'ip' },
      uuidv7(),
    );

    const queueFull = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/api/games/${gameId}/queue`,
        remoteAddress: '203.0.113.42',
        headers: {
          'content-type': 'application/json',
          'x-device-token': uuidv7(),
          'idempotency-key': uuidv7(),
        },
        payload: { displayName: 'Second', autoRequeue: false },
      });

    expect(queueFull.statusCode).toBe(409);
    expect(queueFull.json()).toMatchObject({ code: 'queue_full' });

    await dbService.db.delete(queueEntries).where(eq(queueEntries.gameId, gameId));
    await dbService.db.update(games).set({ maxQueueLen: 20 }).where(eq(games.id, gameId));
    await dbService.db.insert(queueEntries).values({
      id: uuidv7(),
      gameId,
      locationId,
      serviceDate: serviceDateService.current('Asia/Jakarta'),
      ticketNumber: 1,
      displayName: 'Recent',
      status: 'done',
      doneReason: 'played',
      doneAt: new Date(),
      deviceTokenHash: 'cooldown-device',
      ipHash: 'cooldown-ip',
    });

    await expect(
      queueService.enqueue(
        gameId,
        { displayName: 'Recent', autoRequeue: false },
        { deviceTokenHash: 'cooldown-device', deviceProof: 'proof', ipHash: 'cooldown-ip' },
        uuidv7(),
      ),
    ).rejects.toMatchObject({ response: { code: 'rejoin_cooldown' } });
  });

  it('has a database-level unique index for one waiting device entry per queue day', async () => {
    const baseEntry = {
      gameId,
      locationId,
      serviceDate: '2099-01-01',
      displayName: 'Index',
      deviceTokenHash: 'index-device',
      ipHash: 'index-ip',
    };

    await dbService.db.insert(queueEntries).values({
      ...baseEntry,
      id: uuidv7(),
      ticketNumber: 1,
    });

    await expect(
      dbService.db.insert(queueEntries).values({
        ...baseEntry,
        id: uuidv7(),
        ticketNumber: 2,
      }),
    ).rejects.toThrow();
  });
});
