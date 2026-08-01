import { describe, expect, it } from 'vitest';

import {
  locationDetailResponseSchema,
  locationStreamEventSchema,
  queueStreamEventSchema,
} from './queue';

describe('locationDetailResponseSchema', () => {
  it('accepts the public location and game response shape', () => {
    expect(
      locationDetailResponseSchema.parse({
        id: '019f84a3-d031-75d4-b052-ba7792225d56',
        slug: 'machi-local',
        name: 'Machi Arcade',
        address: 'Local development fixture',
        timezone: 'Asia/Jakarta',
        isActive: true,
        games: [
          {
            id: '019f84a3-d038-702a-9d40-5bf7d3f40d8d',
            name: 'Chunithm',
            cabinetLabel: 'Cabinet 1',
            boardMode: 'self_serve',
            isActive: true,
            waitingCount: 0,
          },
        ],
      }),
    ).toMatchObject({
      slug: 'machi-local',
      games: [{ name: 'Chunithm', waitingCount: 0 }],
    });
  });
});

describe('queueStreamEventSchema', () => {
  it('accepts the SSE queue update contract', () => {
    expect(
      queueStreamEventSchema.parse({
        type: 'queue-updated',
        gameId: '019f84a3-d038-702a-9d40-5bf7d3f40d8d',
        serviceDate: '2026-07-21',
        occurredAt: '2026-07-21T12:00:00.000Z',
        board: {
          game: {
            id: '019f84a3-d038-702a-9d40-5bf7d3f40d8d',
            name: 'Chunithm',
            cabinetLabel: 'Cabinet 1',
          },
          serviceDate: '2026-07-21',
          locationTimezone: 'Asia/Jakarta',
          boardMode: 'self_serve',
          requireApprovalForOthers: false,
          locationValidation: { required: false },
          communityNote: null,
          entries: [],
        },
      }),
    ).toMatchObject({ type: 'queue-updated', serviceDate: '2026-07-21' });
  });
});

describe('locationStreamEventSchema', () => {
  it('accepts a hydrated live waiting-count update', () => {
    expect(
      locationStreamEventSchema.parse({
        type: 'location-updated',
        locationId: '019f84a3-d031-75d4-b052-ba7792225d56',
        occurredAt: '2026-07-21T12:00:00.000Z',
        location: {
          id: '019f84a3-d031-75d4-b052-ba7792225d56',
          slug: 'machi-local',
          name: 'Machi Arcade',
          address: null,
          timezone: 'Asia/Jakarta',
          isActive: true,
          games: [],
        },
      }),
    ).toMatchObject({ type: 'location-updated', location: { slug: 'machi-local' } });
  });
});
