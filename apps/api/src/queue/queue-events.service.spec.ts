import { HttpException, type MessageEvent } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ServiceDateService } from '../common/service-date.service';
import { getEnvironment } from '../config/environment';
import type { DbService } from '../db/db.service';
import { QueueEventsService } from './queue-events.service';

const gameId = '019f84a3-d038-702a-9d40-5bf7d3f40d8d';
const locationId = '019f84a3-d031-75d4-b052-ba7792225d56';

function createService(): QueueEventsService {
  return new QueueEventsService({} as DbService, {} as ServiceDateService);
}

describe('QueueEventsService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes typed queue and rollover events to a game stream', () => {
    const service = createService();
    const received: MessageEvent[] = [];
    const subscription = service.stream(gameId, '203.0.113.10').subscribe((event) => {
      received.push(event);
    });

    service.publishQueueUpdated({
      gameId,
      locationId: '019f84a3-d031-75d4-b052-ba7792225d56',
      serviceDate: '2026-07-21',
    });
    service.publishDayRollover(gameId, '2026-07-22');

    expect(received.map((event) => event.type)).toEqual([
      'connected',
      'queue-updated',
      'day-rollover',
    ]);
    expect(received[1]?.data).toMatchObject({ type: 'queue-updated', serviceDate: '2026-07-21' });
    expect(received[2]?.data).toMatchObject({ type: 'day-rollover', serviceDate: '2026-07-22' });

    subscription.unsubscribe();
  });

  it('caps a network at the configured stream limit and releases capacity on unsubscribe', () => {
    const service = createService();
    const subscriptions = Array.from({ length: getEnvironment().maxStreamsPerIp }, () =>
      service.stream(gameId, '203.0.113.11').subscribe(),
    );

    expect(() => service.stream(gameId, '203.0.113.11')).toThrow(HttpException);

    subscriptions[0]?.unsubscribe();
    expect(() => service.stream(gameId, '203.0.113.11')).not.toThrow();

    for (const subscription of subscriptions.slice(1)) {
      subscription.unsubscribe();
    }
  });

  it('publishes queue updates to a location stream for waiting-count refreshes', () => {
    const service = createService();
    const received: MessageEvent[] = [];
    const subscription = service.streamLocation(locationId, '203.0.113.13').subscribe((event) => {
      received.push(event);
    });

    service.publishQueueUpdated({
      gameId,
      locationId,
      serviceDate: '2026-07-21',
    });

    expect(received.map((event) => event.type)).toEqual(['connected', 'location-updated']);
    subscription.unsubscribe();
  });

  it('sends a heartbeat every 25 seconds', async () => {
    vi.useFakeTimers();
    const service = createService();
    const received: MessageEvent[] = [];
    const subscription = service.stream(gameId, '203.0.113.12').subscribe((event) => {
      received.push(event);
    });

    await vi.advanceTimersByTimeAsync(25_000);

    expect(received.map((event) => event.type)).toEqual(['connected', 'heartbeat']);
    subscription.unsubscribe();
  });
});
