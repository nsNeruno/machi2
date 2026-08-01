import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
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
import { adminUsers, games, idempotencyRecords, locations, queueEntries } from '../db/schema';
import { AdminService } from '../admin/admin.service';
import type { AuthenticatedAdmin } from '../admin/admin-context';
import { QueueEventsService } from '../queue/queue-events.service';
import { QueueService } from '../queue/queue.service';

describe('public queue API', () => {
  let app: NestFastifyApplication;
  let dbService: DbService;
  let queueService: QueueService;
  let adminService: AdminService;
  let queueEventsService: QueueEventsService;
  let admin: AuthenticatedAdmin;
  let gameId: string;
  let geofenceLocationId: string;
  let geofenceGameId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    dbService = app.get(DbService);
    queueService = app.get(QueueService);
    adminService = app.get(AdminService);
    queueEventsService = app.get(QueueEventsService);

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

    geofenceLocationId = uuidv7();
    geofenceGameId = uuidv7();
    await dbService.db.insert(locations).values({
      id: geofenceLocationId,
      slug: `integration-geofence-${geofenceLocationId.slice(-8)}`,
      name: 'Integration Geofence',
      timezone: 'Asia/Jakarta',
      latitude: 0,
      longitude: 0,
      locationValidationRadiusMeters: 5,
    });
    await dbService.db.insert(games).values({
      id: geofenceGameId,
      locationId: geofenceLocationId,
      name: 'Geofenced Queue',
      maxQueueLen: 20,
    });

    const [adminUser] = await dbService.db.select().from(adminUsers).limit(1);
    if (!adminUser) {
      throw new Error('Expected a seeded admin user to exist.');
    }
    admin = { user: adminUser, sessionId: 'integration-session', csrfToken: 'integration-csrf' };
  });

  beforeEach(async () => {
    await dbService.db.delete(queueEntries).where(eq(queueEntries.gameId, gameId));
    await dbService.db
      .delete(idempotencyRecords)
      .where(like(idempotencyRecords.scope, `enqueue:${gameId}:%`));
    await dbService.db.delete(queueEntries).where(eq(queueEntries.gameId, geofenceGameId));
    await dbService.db
      .delete(idempotencyRecords)
      .where(like(idempotencyRecords.scope, `enqueue:${geofenceGameId}:%`));
    await dbService.db
      .update(locations)
      .set({
        latitude: 0,
        longitude: 0,
        locationValidationRadiusMeters: 5,
        requireApprovalForOthers: false,
        staffPinHash: null,
      })
      .where(eq(locations.id, geofenceLocationId));
  });

  afterAll(async () => {
    await dbService.db.delete(queueEntries).where(eq(queueEntries.gameId, gameId));
    await dbService.db
      .delete(idempotencyRecords)
      .where(like(idempotencyRecords.scope, `enqueue:${gameId}:%`));
    await dbService.db.delete(games).where(eq(games.id, gameId));
    await dbService.db.delete(locations).where(eq(locations.id, geofenceLocationId));
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

  it('keeps public writes backward compatible when venue coordinates are absent', async () => {
    const response = await queueService.enqueue(
      gameId,
      { displayName: 'No GPS', autoRequeue: false },
      deviceActor(),
      uuidv7(),
    );

    expect(response.entry.displayName).toBe('No GPS');
  });

  it('enforces database coordinate-pair and positive-radius constraints', async () => {
    await expect(
      dbService.db.insert(locations).values({
        id: uuidv7(),
        slug: `invalid-coordinate-${uuidv7()}`,
        name: 'Invalid coordinate',
        timezone: 'Asia/Jakarta',
        latitude: 0,
      }),
    ).rejects.toThrow();
    await expect(
      dbService.db.insert(locations).values({
        id: uuidv7(),
        slug: `invalid-radius-${uuidv7()}`,
        name: 'Invalid radius',
        timezone: 'Asia/Jakarta',
        locationValidationRadiusMeters: 0,
      }),
    ).rejects.toThrow();
  });

  it('updates admin geofence settings and refreshes open public boards', async () => {
    const eventTypes: Array<string | undefined> = [];
    const subscription = queueEventsService
      .stream(geofenceGameId, 'integration-admin-update', { enforceLimit: false })
      .subscribe((event) => eventTypes.push(event.type));

    const updated = await adminService.updateLocation(admin, geofenceLocationId, {
      latitude: 1,
      longitude: 2,
      locationValidationRadiusMeters: 12,
    });

    expect(updated).toMatchObject({
      latitude: 1,
      longitude: 2,
      locationValidationRadiusMeters: 12,
    });
    expect(eventTypes).toEqual(['connected', 'queue-updated']);
    expect(
      (await queueService.board(geofenceGameId, 'all', undefined)).locationValidation,
    ).toMatchObject({ required: true, latitude: 1, longitude: 2, radiusMeters: 12 });
    subscription.unsubscribe();
  });

  it('exposes geofence policy and rejects missing, inaccurate, and outside positions', async () => {
    const board = await queueService.board(geofenceGameId, 'all', undefined);
    expect(board.locationValidation).toEqual({
      required: true,
      latitude: 0,
      longitude: 0,
      radiusMeters: 5,
      maxAccuracyMeters: 20,
    });

    const rejectedInputs = [
      {
        input: { displayName: 'Missing', autoRequeue: false },
        code: 'location_verification_required',
      },
      {
        input: {
          displayName: 'Blurry',
          autoRequeue: false,
          position: { latitude: 0, longitude: 0, accuracyMeters: 21 },
        },
        code: 'location_too_inaccurate',
      },
      {
        input: {
          displayName: 'Far away',
          autoRequeue: false,
          position: { latitude: 0, longitude: 0.001, accuracyMeters: 5 },
        },
        code: 'outside_location_range',
      },
    ];

    for (const rejected of rejectedInputs) {
      await expectProblemCode(
        queueService.enqueue(geofenceGameId, rejected.input, deviceActor(), uuidv7()),
        rejected.code,
      );
    }

    const entries = await dbService.db
      .select()
      .from(queueEntries)
      .where(eq(queueEntries.gameId, geofenceGameId));
    expect(entries).toHaveLength(0);
  });

  it('accepts in-range writes and replays an idempotent result without a new position', async () => {
    const idempotencyKey = uuidv7();
    const actor = deviceActor();
    const first = await queueService.enqueue(
      geofenceGameId,
      {
        displayName: 'Nearby',
        autoRequeue: false,
        position: { latitude: 0, longitude: 0, accuracyMeters: 20 },
      },
      actor,
      idempotencyKey,
    );
    const replay = await queueService.enqueue(
      geofenceGameId,
      { displayName: 'Nearby', autoRequeue: false },
      actor,
      idempotencyKey,
    );

    expect(replay).toEqual(first);
  });

  it('lets a failed location check recover with the same idempotency key', async () => {
    const actor = deviceActor();
    const idempotencyKey = uuidv7();
    await expectProblemCode(
      queueService.enqueue(
        geofenceGameId,
        { displayName: 'Retry', autoRequeue: false },
        actor,
        idempotencyKey,
      ),
      'location_verification_required',
    );

    const retry = await queueService.enqueue(
      geofenceGameId,
      {
        displayName: 'Retry',
        autoRequeue: false,
        position: { latitude: 0, longitude: 0, accuracyMeters: 5 },
      },
      actor,
      idempotencyKey,
    );
    expect(retry.entry.displayName).toBe('Retry');
  });

  it('gates public completion but leaves authenticated admin completion exempt', async () => {
    const owner = deviceActor();
    const enqueue = await queueService.enqueue(
      geofenceGameId,
      {
        displayName: 'Owner',
        autoRequeue: false,
        position: { latitude: 0, longitude: 0, accuracyMeters: 5 },
      },
      owner,
      uuidv7(),
    );
    const entry = enqueue.entry;
    await expectProblemCode(
      queueService.complete(entry.id, { reason: 'played', actingName: 'Owner' }, owner, uuidv7()),
      'location_verification_required',
    );

    await adminService.markEntryDone(admin, entry.id, 'played');
    const [completed] = await dbService.db
      .select({ status: queueEntries.status, doneByRole: queueEntries.doneByRole })
      .from(queueEntries)
      .where(eq(queueEntries.id, entry.id));
    expect(completed).toEqual({ status: 'done', doneByRole: 'admin' });
  });

  it('requires location for public staff-PIN completion and accepts it in range', async () => {
    await dbService.db
      .update(locations)
      .set({ requireApprovalForOthers: true, staffPinHash: await argon2.hash('2468') })
      .where(eq(locations.id, geofenceLocationId));
    const ownerToken = uuidv7();
    const owner = deviceActor(ownerToken);
    const enqueue = await queueService.enqueue(
      geofenceGameId,
      {
        displayName: 'Player',
        autoRequeue: false,
        position: { latitude: 0, longitude: 0, accuracyMeters: 5 },
      },
      owner,
      uuidv7(),
    );
    const entry = enqueue.entry;
    const staff = deviceActor();
    const completionKey = uuidv7();
    await expectProblemCode(
      queueService.complete(entry.id, { reason: 'played', staffPin: '2468' }, staff, completionKey),
      'location_verification_required',
    );

    const completion = await queueService.complete(
      entry.id,
      {
        reason: 'played',
        staffPin: '2468',
        position: { latitude: 0, longitude: 0, accuracyMeters: 5 },
      },
      staff,
      completionKey,
    );
    expect(completion.entry).toMatchObject({
      status: 'done',
      doneByRole: 'staff',
    });
  });
});

function deviceActor(deviceTokenHash = uuidv7()) {
  return {
    deviceTokenHash,
    deviceProof: `proof-${deviceTokenHash}`,
    ipHash: `ip-${deviceTokenHash}`,
  };
}

async function expectProblemCode(request: Promise<unknown>, code: string): Promise<void> {
  try {
    await request;
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(error).toMatchObject({ response: { code } });
  }
}
