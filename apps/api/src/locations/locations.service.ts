import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';

import { ServiceDateService } from '../common/service-date.service';
import { DbService } from '../db/db.service';
import { games, locations, queueEntries } from '../db/schema';

export type QueueContext = {
  game: typeof games.$inferSelect;
  location: typeof locations.$inferSelect;
  serviceDate: string;
};

@Injectable()
export class LocationsService {
  constructor(
    private readonly dbService: DbService,
    private readonly serviceDateService: ServiceDateService,
  ) {}

  async listPublic(): Promise<
    Array<{
      id: string;
      slug: string;
      name: string;
      address: string | null;
      timezone: string;
      isActive: boolean;
    }>
  > {
    return this.dbService.db
      .select({
        id: locations.id,
        slug: locations.slug,
        name: locations.name,
        address: locations.address,
        timezone: locations.timezone,
        isActive: locations.isActive,
      })
      .from(locations)
      .orderBy(asc(locations.name));
  }

  async getLocationDetail(slug: string): Promise<{
    id: string;
    slug: string;
    name: string;
    address: string | null;
    timezone: string;
    isActive: boolean;
    games: Array<{
      id: string;
      name: string;
      cabinetLabel: string | null;
      boardMode: 'self_serve' | 'now_playing';
      isActive: boolean;
      waitingCount: number;
    }>;
  }> {
    const location = await this.findLocationBySlug(slug);
    const serviceDate = this.serviceDateService.current(location.timezone);
    const waitingCount = sql<number>`count(${queueEntries.id})`.mapWith(Number);
    const gameRows = await this.dbService.db
      .select({
        id: games.id,
        name: games.name,
        cabinetLabel: games.cabinetLabel,
        boardMode: games.boardMode,
        isActive: games.isActive,
        waitingCount,
      })
      .from(games)
      .leftJoin(
        queueEntries,
        and(
          eq(queueEntries.gameId, games.id),
          eq(queueEntries.serviceDate, serviceDate),
          eq(queueEntries.status, 'waiting'),
        ),
      )
      .where(eq(games.locationId, location.id))
      .groupBy(games.id)
      .orderBy(asc(games.sortOrder), asc(games.name));

    return {
      id: location.id,
      slug: location.slug,
      name: location.name,
      address: location.address,
      timezone: location.timezone,
      isActive: location.isActive,
      games: gameRows,
    };
  }

  async getQueueContext(gameId: string): Promise<QueueContext> {
    const [result] = await this.dbService.db
      .select({ game: games, location: locations })
      .from(games)
      .innerJoin(locations, eq(games.locationId, locations.id))
      .where(eq(games.id, gameId))
      .limit(1);

    if (!result) {
      throw new NotFoundException({ code: 'game_not_found', message: 'Game not found.' });
    }

    return {
      game: result.game,
      location: result.location,
      serviceDate: this.serviceDateService.current(result.location.timezone),
    };
  }

  async getContextForEntry(entryId: string): Promise<QueueContext> {
    const [result] = await this.dbService.db
      .select({ game: games, location: locations })
      .from(queueEntries)
      .innerJoin(games, eq(queueEntries.gameId, games.id))
      .innerJoin(locations, eq(games.locationId, locations.id))
      .where(eq(queueEntries.id, entryId))
      .limit(1);

    if (!result) {
      throw new NotFoundException({
        code: 'queue_entry_not_found',
        message: 'Queue entry not found.',
      });
    }

    return {
      game: result.game,
      location: result.location,
      serviceDate: this.serviceDateService.current(result.location.timezone),
    };
  }

  private async findLocationBySlug(slug: string): Promise<typeof locations.$inferSelect> {
    const [location] = await this.dbService.db
      .select()
      .from(locations)
      .where(eq(locations.slug, slug))
      .limit(1);

    if (!location) {
      throw new NotFoundException({ code: 'location_not_found', message: 'Location not found.' });
    }

    return location;
  }
}
