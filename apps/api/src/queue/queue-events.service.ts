import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  type MessageEvent,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { QueueStreamSignal } from '@machi2/shared';
import { and, eq } from 'drizzle-orm';
import { EventEmitter } from 'node:events';
import { Observable } from 'rxjs';

import { ServiceDateService } from '../common/service-date.service';
import { getEnvironment } from '../config/environment';
import { DbService } from '../db/db.service';
import { games, locations } from '../db/schema';

const heartbeatIntervalMs = 25_000;
const rolloverCheckIntervalMs = 60_000;
// Concurrent SSE cap, per IP. Every device on your Wi-Fi reaches the API through the
// Vite proxy from loopback, so they all share one IP bucket in dev — raise it there
// (MAX_STREAMS_PER_IP) or a second device's live board silently can't connect.
const maxStreamsPerIp = getEnvironment().maxStreamsPerIp;

type QueueEventTarget = {
  gameId: string;
  locationId: string;
  serviceDate: string;
};

type LocationStreamSignal = {
  type: 'connected' | 'heartbeat' | 'location-updated';
  locationId: string;
  occurredAt: string;
};

@Injectable()
export class QueueEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly eventEmitter = new EventEmitter();
  private readonly openStreamsByIp = new Map<string, number>();
  private readonly serviceDates = new Map<string, string>();
  private rolloverTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly dbService: DbService,
    private readonly serviceDateService: ServiceDateService,
  ) {
    // Popular boards legitimately exceed Node's default ten-listener warning threshold;
    // actual stream capacity is governed per IP by reserveStream().
    this.eventEmitter.setMaxListeners(0);
  }

  async onModuleInit(): Promise<void> {
    await this.rememberCurrentServiceDates();
    this.rolloverTimer = setInterval(() => {
      void this.checkForDayRollovers().catch((error: unknown) => {
        Logger.error(error, 'QueueEventsService');
      });
    }, rolloverCheckIntervalMs);
    this.rolloverTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.rolloverTimer) {
      clearInterval(this.rolloverTimer);
      this.rolloverTimer = null;
    }
  }

  stream(
    gameId: string,
    ip: string,
    options: { enforceLimit?: boolean } = {},
  ): Observable<MessageEvent> {
    const enforceLimit = options.enforceLimit ?? true;
    if (enforceLimit) {
      this.reserveStream(ip);
    }

    return new Observable<MessageEvent>((subscriber) => {
      const listener = (event: QueueStreamSignal) => {
        subscriber.next({ type: event.type, data: event });
      };
      const heartbeat = setInterval(() => {
        listener({ type: 'heartbeat', gameId, occurredAt: new Date().toISOString() });
      }, heartbeatIntervalMs);

      this.eventEmitter.on(this.eventName(gameId), listener);
      listener({ type: 'connected', gameId, occurredAt: new Date().toISOString() });

      return () => {
        clearInterval(heartbeat);
        this.eventEmitter.off(this.eventName(gameId), listener);
        if (enforceLimit) {
          this.releaseStream(ip);
        }
      };
    });
  }

  streamLocation(locationId: string, ip: string): Observable<MessageEvent> {
    this.reserveStream(ip);

    return new Observable<MessageEvent>((subscriber) => {
      const listener = (event: LocationStreamSignal) => {
        subscriber.next({ type: event.type, data: event });
      };
      const heartbeat = setInterval(() => {
        listener({ type: 'heartbeat', locationId, occurredAt: new Date().toISOString() });
      }, heartbeatIntervalMs);

      this.eventEmitter.on(this.locationEventName(locationId), listener);
      listener({ type: 'connected', locationId, occurredAt: new Date().toISOString() });

      return () => {
        clearInterval(heartbeat);
        this.eventEmitter.off(this.locationEventName(locationId), listener);
        this.releaseStream(ip);
      };
    });
  }

  /** Total number of open SSE connections across all IPs — a load-governor signal. */
  totalOpenStreams(): number {
    let total = 0;
    for (const count of this.openStreamsByIp.values()) {
      total += count;
    }
    return total;
  }

  publishQueueUpdated(target: QueueEventTarget): void {
    this.publish(target.gameId, {
      type: 'queue-updated',
      gameId: target.gameId,
      serviceDate: target.serviceDate,
      occurredAt: new Date().toISOString(),
    });
    this.eventEmitter.emit(this.locationEventName(target.locationId), {
      type: 'location-updated',
      locationId: target.locationId,
      occurredAt: new Date().toISOString(),
    } satisfies LocationStreamSignal);
  }

  async publishLocationConfigurationChanged(locationId: string): Promise<void> {
    const [location] = await this.dbService.db
      .select({ id: locations.id, timezone: locations.timezone })
      .from(locations)
      .where(eq(locations.id, locationId))
      .limit(1);
    if (!location) {
      return;
    }

    const serviceDate = this.serviceDateService.current(location.timezone);
    const locationGames = await this.dbService.db
      .select({ id: games.id })
      .from(games)
      .where(eq(games.locationId, locationId));

    for (const game of locationGames) {
      this.publish(game.id, {
        type: 'queue-updated',
        gameId: game.id,
        serviceDate,
        occurredAt: new Date().toISOString(),
      });
    }
    this.eventEmitter.emit(this.locationEventName(locationId), {
      type: 'location-updated',
      locationId,
      occurredAt: new Date().toISOString(),
    } satisfies LocationStreamSignal);
  }

  async checkForDayRollovers(now = new Date()): Promise<void> {
    const activeLocations = await this.dbService.db
      .select({ id: locations.id, timezone: locations.timezone })
      .from(locations)
      .where(eq(locations.isActive, true));

    for (const location of activeLocations) {
      const serviceDate = this.serviceDateService.current(location.timezone, now);
      const previousServiceDate = this.serviceDates.get(location.id);
      this.serviceDates.set(location.id, serviceDate);

      if (!previousServiceDate || previousServiceDate === serviceDate) {
        continue;
      }

      const locationGames = await this.dbService.db
        .select({ id: games.id })
        .from(games)
        .where(and(eq(games.locationId, location.id), eq(games.isActive, true)));

      for (const game of locationGames) {
        this.publishDayRollover(game.id, serviceDate);
      }
    }
  }

  private async rememberCurrentServiceDates(): Promise<void> {
    const activeLocations = await this.dbService.db
      .select({ id: locations.id, timezone: locations.timezone })
      .from(locations)
      .where(eq(locations.isActive, true));

    for (const location of activeLocations) {
      this.serviceDates.set(location.id, this.serviceDateService.current(location.timezone));
    }
  }

  publishDayRollover(gameId: string, serviceDate: string): void {
    this.publish(gameId, {
      type: 'day-rollover',
      gameId,
      serviceDate,
      occurredAt: new Date().toISOString(),
    });
  }

  private reserveStream(ip: string): void {
    const current = this.openStreamsByIp.get(ip) ?? 0;
    if (current >= maxStreamsPerIp) {
      throw new HttpException(
        {
          code: 'stream_limit_reached',
          message: 'Too many live queue connections from this network.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.openStreamsByIp.set(ip, current + 1);
  }

  private releaseStream(ip: string): void {
    const current = this.openStreamsByIp.get(ip) ?? 0;
    if (current <= 1) {
      this.openStreamsByIp.delete(ip);
      return;
    }
    this.openStreamsByIp.set(ip, current - 1);
  }

  private publish(gameId: string, event: QueueStreamSignal): void {
    this.eventEmitter.emit(this.eventName(gameId), event);
  }

  private eventName(gameId: string): string {
    return `queue:${gameId}`;
  }

  private locationEventName(locationId: string): string {
    return `location:${locationId}`;
  }
}
