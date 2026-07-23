import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Sse,
  UseGuards,
  type MessageEvent,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  adminMarkDoneSchema,
  adminQueueStreamEventSchema,
  type AdminClearQueueResponse,
  type AdminQueueBoardResponse,
  type QueueStreamSignal,
} from '@machi2/shared';
import type { FastifyRequest } from 'fastify';
import { concatMap, Observable } from 'rxjs';

import { CurrentAdmin, type AuthenticatedAdmin } from './admin-context';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';
import { parseBody } from './admin-validation';
import { QueueEventsService } from '../queue/queue-events.service';

@Controller('admin')
@UseGuards(AdminGuard)
@SkipThrottle()
export class AdminQueueController {
  constructor(
    private readonly adminService: AdminService,
    private readonly queueEventsService: QueueEventsService,
  ) {}

  @Get('games/:id/queue')
  queue(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') id: string,
  ): Promise<AdminQueueBoardResponse> {
    return this.adminService.queueBoard(admin, id);
  }

  @Sse('games/:id/stream')
  async stream(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') id: string,
    @Req() request: FastifyRequest,
  ): Promise<Observable<MessageEvent>> {
    await this.adminService.assertGameAccessible(admin, id);

    // Authenticated staff are exempt from the public per-IP stream cap.
    return this.queueEventsService.stream(id, request.ip, { enforceLimit: false }).pipe(
      concatMap(async (message) => {
        const signal = message.data as QueueStreamSignal;
        if (signal.type === 'connected' || signal.type === 'heartbeat') {
          return message;
        }
        const board = await this.adminService.queueBoard(admin, id);
        return {
          type: signal.type,
          data: adminQueueStreamEventSchema.parse({ ...signal, board }),
        };
      }),
    );
  }

  @Post('queue-entries/:id/done')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markDone(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<void> {
    const input = parseBody(adminMarkDoneSchema, body, 'invalid_completion', 'Completion details are invalid.');
    await this.adminService.markEntryDone(admin, id, input.reason);
  }

  @Delete('queue-entries/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') id: string,
  ): Promise<void> {
    await this.adminService.deleteEntry(admin, id);
  }

  @Post('games/:id/queue/clear')
  async clear(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') id: string,
  ): Promise<AdminClearQueueResponse> {
    return { removed: await this.adminService.clearQueue(admin, id) };
  }
}
