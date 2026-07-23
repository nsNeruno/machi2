import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  governorStatusSchema,
  loadLevelOrder,
  writesAreShed,
  type GovernorStatus,
  type LoadLevel,
} from '@machi2/shared';
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

import { eq } from 'drizzle-orm';

import { DbService } from '../db/db.service';
import { appMeta } from '../db/schema';
import { QueueEventsService } from '../queue/queue-events.service';

const TICK_MS = 2_000;
const RECOVERY_COOLDOWN_MS = 30_000;
const MIRROR_KEY = 'governor_state';

// Starting thresholds — tune against real traffic (CLAUDE.md §6 / ARCHITECTURE governance).
const THRESHOLDS: Record<Exclude<LoadLevel, 'normal' | 'maintenance'>, {
  requestsPerSecond: number;
  enqueuesPerSecond: number;
  openStreams: number;
  rssMb: number;
  eventLoopLagMs: number;
}> = {
  elevated: { requestsPerSecond: 40, enqueuesPerSecond: 8, openStreams: 200, rssMb: 400, eventLoopLagMs: 50 },
  shed: { requestsPerSecond: 120, enqueuesPerSecond: 20, openStreams: 400, rssMb: 700, eventLoopLagMs: 200 },
};

/**
 * Reads local signals on a short tick and derives a load level with hysteretic recovery.
 * Defence in depth only — the hard stop lives at Cloudflare + the provider cap (CLAUDE.md §2).
 * A manual override can raise the level (e.g. maintenance) but never mask a real overload.
 */
@Injectable()
export class LoadGovernorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LoadGovernorService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private loopDelay: IntervalHistogram | null = null;

  private requestCount = 0;
  private enqueueCount = 0;
  private autoLevel: LoadLevel = 'normal';
  private manualLevel: LoadLevel | null = null;
  private manualReason: string | null = null;
  private belowSince = Date.now();
  private status: GovernorStatus = emptyStatus();

  constructor(
    private readonly dbService: DbService,
    private readonly queueEventsService: QueueEventsService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.loopDelay = monitorEventLoopDelay({ resolution: 20 });
    this.loopDelay.enable();
    await this.restoreOverride();
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.loopDelay?.disable();
  }

  recordRequest(): void {
    this.requestCount += 1;
  }

  recordEnqueue(): void {
    this.enqueueCount += 1;
  }

  level(): LoadLevel {
    return this.status.level;
  }

  writesShed(): boolean {
    return writesAreShed(this.status.level);
  }

  getStatus(): GovernorStatus {
    return this.status;
  }

  /** Manually set (or clear, with null) the override, mirror it, and recompute. */
  async setOverride(level: LoadLevel | null, reason: string | null): Promise<GovernorStatus> {
    this.manualLevel = level;
    this.manualReason = level ? reason : null;
    this.tick();
    await this.mirror();
    return this.status;
  }

  private tick(): void {
    const requestsPerSecond = this.requestCount / (TICK_MS / 1000);
    const enqueuesPerSecond = this.enqueueCount / (TICK_MS / 1000);
    this.requestCount = 0;
    this.enqueueCount = 0;

    const openStreams = this.queueEventsService.totalOpenStreams();
    const rssMb = process.memoryUsage().rss / (1024 * 1024);
    const eventLoopLagMs = this.loopDelay ? this.loopDelay.mean / 1_000_000 : 0;
    this.loopDelay?.reset();

    const signals = { requestsPerSecond, enqueuesPerSecond, openStreams, rssMb, eventLoopLagMs };
    const instantaneous = this.classify(signals);

    // Step up immediately; step down only after signals stay calmer than the cooldown window.
    if (severity(instantaneous) >= severity(this.autoLevel)) {
      this.autoLevel = instantaneous;
      this.belowSince = Date.now();
    } else if (Date.now() - this.belowSince >= RECOVERY_COOLDOWN_MS) {
      this.autoLevel = instantaneous;
      this.belowSince = Date.now();
    }

    const previousLevel = this.status.level;
    const effective = mostSevere(this.autoLevel, this.manualLevel ?? 'normal');
    this.status = {
      level: effective,
      autoLevel: this.autoLevel,
      manualLevel: this.manualLevel,
      reason: this.manualReason,
      signals: {
        requestsPerSecond: round(requestsPerSecond),
        enqueuesPerSecond: round(enqueuesPerSecond),
        openStreams,
        rssMb: round(rssMb),
        eventLoopLagMs: round(eventLoopLagMs),
      },
      updatedAt: new Date().toISOString(),
    };

    if (effective !== previousLevel) {
      this.logger.warn(`Load level ${previousLevel} → ${effective}`);
      void this.mirror();
    }
  }

  private classify(signals: {
    requestsPerSecond: number;
    enqueuesPerSecond: number;
    openStreams: number;
    rssMb: number;
    eventLoopLagMs: number;
  }): LoadLevel {
    const exceeds = (band: (typeof THRESHOLDS)['elevated']): boolean =>
      signals.requestsPerSecond >= band.requestsPerSecond ||
      signals.enqueuesPerSecond >= band.enqueuesPerSecond ||
      signals.openStreams >= band.openStreams ||
      signals.rssMb >= band.rssMb ||
      signals.eventLoopLagMs >= band.eventLoopLagMs;

    if (exceeds(THRESHOLDS.shed)) {
      return 'shed';
    }
    if (exceeds(THRESHOLDS.elevated)) {
      return 'elevated';
    }
    return 'normal';
  }

  private async mirror(): Promise<void> {
    try {
      await this.dbService.db
        .insert(appMeta)
        .values({ key: MIRROR_KEY, value: JSON.stringify(this.status) })
        .onConflictDoUpdate({ target: appMeta.key, set: { value: JSON.stringify(this.status) } });
    } catch (error: unknown) {
      this.logger.error(error);
    }
  }

  private async restoreOverride(): Promise<void> {
    try {
      const [row] = await this.dbService.db
        .select({ value: appMeta.value })
        .from(appMeta)
        .where(eq(appMeta.key, MIRROR_KEY))
        .limit(1);
      if (!row) {
        return;
      }
      const parsed = governorStatusSchema.safeParse(JSON.parse(row.value));
      if (parsed.success && parsed.data.manualLevel) {
        this.manualLevel = parsed.data.manualLevel;
        this.manualReason = parsed.data.reason;
      }
    } catch (error: unknown) {
      this.logger.error(error);
    }
  }
}

function severity(level: LoadLevel): number {
  return loadLevelOrder.indexOf(level);
}

function mostSevere(a: LoadLevel, b: LoadLevel): LoadLevel {
  return severity(a) >= severity(b) ? a : b;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function emptyStatus(): GovernorStatus {
  return {
    level: 'normal',
    autoLevel: 'normal',
    manualLevel: null,
    reason: null,
    signals: { requestsPerSecond: 0, enqueuesPerSecond: 0, openStreams: 0, rssMb: 0, eventLoopLagMs: 0 },
    updatedAt: new Date().toISOString(),
  };
}
