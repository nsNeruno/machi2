import { Controller, Get, Param, Req, Sse, UseGuards, type MessageEvent } from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { locationStreamEventSchema } from '@machi2/shared';
import type { FastifyRequest } from 'fastify';
import { concatMap, Observable } from 'rxjs';

import { LocationsService } from './locations.service';
import { getEnvironment } from '../config/environment';
import { QueueEventsService } from '../queue/queue-events.service';

const env = getEnvironment();

@Controller('locations')
@UseGuards(ThrottlerGuard)
@Throttle({ read: { limit: env.readIpLimit, ttl: env.readIpTtlMs } })
@SkipThrottle({ enqueue: true, complete: true })
export class LocationsController {
  constructor(
    private readonly locationsService: LocationsService,
    private readonly queueEventsService: QueueEventsService,
  ) {}

  @Get()
  listPublic() {
    return this.locationsService.listPublic();
  }

  @Sse(':slug/stream')
  async stream(
    @Param('slug') slug: string,
    @Req() request: FastifyRequest,
  ): Promise<Observable<MessageEvent>> {
    const location = await this.locationsService.getLocationDetail(slug);

    return this.queueEventsService.streamLocation(location.id, request.ip).pipe(
      concatMap(async (message) => {
        const signal = message.data as {
          type: 'connected' | 'heartbeat' | 'location-updated';
          locationId: string;
          occurredAt: string;
        };
        if (signal.type === 'connected' || signal.type === 'heartbeat') {
          return message;
        }

        return {
          type: signal.type,
          data: locationStreamEventSchema.parse({
            ...signal,
            location: await this.locationsService.getLocationDetail(slug),
          }),
        };
      }),
    );
  }

  @Get(':slug')
  getBySlug(@Param('slug') slug: string) {
    return this.locationsService.getLocationDetail(slug);
  }
}
