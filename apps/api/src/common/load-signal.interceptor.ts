import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';

import { LoadGovernorService } from './load-governor.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ENQUEUE_PATH = /^\/api\/games\/[^/]+\/queue(?:\?.*)?$/;
const RETRY_AFTER_SECONDS = 15;

/**
 * Records request/enqueue signals for the load governor and sheds public writes when the
 * governor is at `shed`/`maintenance`. Reads always pass so the queue stays viewable, and
 * admin routes are never shed so staff can still operate and lift maintenance.
 */
@Injectable()
export class LoadSignalInterceptor implements NestInterceptor {
  constructor(private readonly governor: LoadGovernorService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    this.governor.recordRequest();

    const isWrite = !SAFE_METHODS.has(request.method);
    const url = request.url ?? '';
    if (request.method === 'POST' && ENQUEUE_PATH.test(url)) {
      this.governor.recordEnqueue();
    }

    if (isWrite && !url.startsWith('/api/admin') && this.governor.writesShed()) {
      const reply = context.switchToHttp().getResponse<FastifyReply>();
      reply.header('retry-after', String(RETRY_AFTER_SECONDS));
      throw new ServiceUnavailableException({
        code: 'load_shed',
        message: 'The queue is busy right now. Please try again shortly.',
      });
    }

    return next.handle();
  }
}
