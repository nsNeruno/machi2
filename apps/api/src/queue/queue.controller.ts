import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  Sse,
  UseGuards,
  type MessageEvent,
} from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  completeQueueEntrySchema,
  enqueueQueueSchema,
  queueStreamEventSchema,
  type QueueStreamSignal,
  queueScopeSchema,
} from '@machi2/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { concatMap, Observable } from 'rxjs';
import { z } from 'zod';

import { DeviceTokenService } from '../common/device-token.service';
import { getEnvironment } from '../config/environment';
import { QueueEventsService } from './queue-events.service';
import { QueueService } from './queue.service';

const env = getEnvironment();

@Controller('games')
export class GamesQueueController {
  constructor(
    private readonly queueService: QueueService,
    private readonly deviceTokenService: DeviceTokenService,
    private readonly queueEventsService: QueueEventsService,
  ) {}

  @Get(':id/queue')
  @UseGuards(ThrottlerGuard)
  @Throttle({ read: { limit: env.readIpLimit, ttl: env.readIpTtlMs } })
  @SkipThrottle({ enqueue: true, complete: true })
  async board(
    @Param('id') gameId: string,
    @Query('scope') scope: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const parsedScope = queueScopeSchema.safeParse(scope ?? 'recent');
    if (!parsedScope.success) {
      throw new BadRequestException({
        code: 'invalid_queue_scope',
        message: 'Queue scope must be recent or all.',
      });
    }

    const actor = this.deviceTokenService.optionalActor(request);
    this.deviceTokenService.attachProof(reply, actor);
    return this.queueService.board(
      this.requireUuid(gameId, 'invalid_game_id'),
      parsedScope.data,
      actor?.deviceTokenHash,
    );
  }

  @Sse(':id/stream')
  @UseGuards(ThrottlerGuard)
  @Throttle({ read: { limit: env.readIpLimit, ttl: env.readIpTtlMs } })
  @SkipThrottle({ enqueue: true, complete: true })
  async stream(
    @Param('id') gameId: string,
    @Req() request: FastifyRequest,
  ): Promise<Observable<MessageEvent>> {
    const parsedGameId = this.requireUuid(gameId, 'invalid_game_id');
    await this.queueService.assertGameExists(parsedGameId);
    const actor = this.deviceTokenService.optionalActor(request);

    return this.queueEventsService.stream(parsedGameId, request.ip).pipe(
      concatMap(async (message) => {
        const signal = message.data as QueueStreamSignal;
        if (signal.type === 'connected' || signal.type === 'heartbeat') {
          return message;
        }

        const board = await this.queueService.board(parsedGameId, 'all', actor?.deviceTokenHash);
        return {
          type: signal.type,
          data: queueStreamEventSchema.parse({ ...signal, board }),
        };
      }),
    );
  }

  @Post(':id/queue')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ThrottlerGuard)
  @Throttle({ enqueue: { limit: env.enqueueIpLimit, ttl: env.enqueueIpTtlMs } })
  @SkipThrottle({ read: true, complete: true })
  async enqueue(
    @Param('id') gameId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const parsedBody = enqueueQueueSchema.safeParse(body);
    if (!parsedBody.success) {
      throw new BadRequestException({
        code: 'invalid_enqueue_input',
        message: 'Queue entry details are invalid.',
        details: parsedBody.error.flatten(),
      });
    }

    const actor = this.deviceTokenService.requireActor(request);
    this.deviceTokenService.attachProof(reply, actor);
    return this.queueService.enqueue(
      this.requireUuid(gameId, 'invalid_game_id'),
      parsedBody.data,
      actor,
      this.requireIdempotencyKey(idempotencyKey),
    );
  }

  private requireIdempotencyKey(value: string | undefined): string {
    if (!value || value.length > 255) {
      throw new BadRequestException({
        code: 'idempotency_key_required',
        message: 'Idempotency-Key is required and must be at most 255 characters.',
      });
    }
    return value;
  }

  private requireUuid(value: string, code: string): string {
    if (!z.uuid().safeParse(value).success) {
      throw new BadRequestException({ code, message: 'ID must be a UUID.' });
    }
    return value;
  }
}

@Controller('queue-entries')
export class QueueEntriesController {
  constructor(
    private readonly queueService: QueueService,
    private readonly deviceTokenService: DeviceTokenService,
  ) {}

  @Post(':id/done')
  @UseGuards(ThrottlerGuard)
  @Throttle({ complete: { limit: 10, ttl: 60_000 } })
  @SkipThrottle({ read: true, enqueue: true })
  async complete(
    @Param('id') entryId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const parsedBody = completeQueueEntrySchema.safeParse(body);
    if (!parsedBody.success) {
      throw new BadRequestException({
        code: 'invalid_completion_input',
        message: 'Completion details are invalid.',
        details: parsedBody.error.flatten(),
      });
    }

    const actor = this.deviceTokenService.requireActor(request);
    this.deviceTokenService.attachProof(reply, actor);
    return this.queueService.complete(
      this.requireUuid(entryId, 'invalid_queue_entry_id'),
      parsedBody.data,
      actor,
      this.requireIdempotencyKey(idempotencyKey),
    );
  }

  private requireIdempotencyKey(value: string | undefined): string {
    if (!value || value.length > 255) {
      throw new BadRequestException({
        code: 'idempotency_key_required',
        message: 'Idempotency-Key is required and must be at most 255 characters.',
      });
    }
    return value;
  }

  private requireUuid(value: string, code: string): string {
    if (!z.uuid().safeParse(value).success) {
      throw new BadRequestException({ code, message: 'ID must be a UUID.' });
    }
    return value;
  }
}
