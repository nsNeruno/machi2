import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { renderNotFoundPage } from './not-found-page';

type ProblemBody = {
  code: string;
  message: string;
  details?: unknown;
};

/**
 * Codes and wording for failures raised by the framework rather than by our own
 * services — an unmatched route, a malformed body, a payload over the limit.
 * Anything thrown with an explicit `{ code, message }` keeps its own wording.
 */
const STATUS_PROBLEMS: Record<number, ProblemBody> = {
  [HttpStatus.BAD_REQUEST]: {
    code: 'bad_request',
    message: '400 Bad Request: the server could not read that request.',
  },
  [HttpStatus.UNAUTHORIZED]: {
    code: 'unauthorized',
    message: '401 Unauthorized: sign in to do that.',
  },
  [HttpStatus.FORBIDDEN]: {
    code: 'forbidden',
    message: '403 Forbidden: you are not allowed to do that.',
  },
  [HttpStatus.NOT_FOUND]: {
    code: 'not_found',
    message: '404 Not Found: this address is not available on this server.',
  },
  [HttpStatus.METHOD_NOT_ALLOWED]: {
    code: 'method_not_allowed',
    message: '405 Method Not Allowed: that address does not accept this method.',
  },
  [HttpStatus.CONFLICT]: {
    code: 'conflict',
    message: '409 Conflict: that action conflicts with the current state.',
  },
  [HttpStatus.PAYLOAD_TOO_LARGE]: {
    code: 'payload_too_large',
    message: '413 Payload Too Large: that request body is too big.',
  },
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: {
    code: 'unsupported_media_type',
    message: '415 Unsupported Media Type: send JSON.',
  },
  [HttpStatus.TOO_MANY_REQUESTS]: {
    code: 'rate_limited',
    message:
      '429 Too Many Requests: you are sending requests too quickly. Wait a few seconds and try again.',
  },
  [HttpStatus.SERVICE_UNAVAILABLE]: {
    code: 'service_unavailable',
    message: '503 Service Unavailable: the queue is temporarily unavailable. Try again shortly.',
  },
};

@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const request = http.getRequest<FastifyRequest>();

      if (status === HttpStatus.NOT_FOUND && this.wantsNotFoundPage(request)) {
        reply.status(status).type('text/html; charset=utf-8').send(renderNotFoundPage());
        return;
      }

      reply.status(status).send(this.toProblemBody(exception.getResponse(), status));
      return;
    }

    this.logger.error(exception);
    reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      code: 'internal_error',
      message: '500 Internal Server Error: something went wrong on our side.',
    } satisfies ProblemBody);
  }

  /**
   * A browser that walked into a non-`/api` path gets readable HTML; API clients
   * and anything under `/api` always get the JSON problem body.
   */
  private wantsNotFoundPage(request: FastifyRequest | undefined): boolean {
    if (!request) {
      return false;
    }
    const path = (request.url ?? '').split('?')[0] ?? '';
    if (path === '/api' || path.startsWith('/api/')) {
      return false;
    }
    const accept = request.headers?.accept ?? '';
    return accept.includes('text/html');
  }

  private toProblemBody(response: string | object, status: number): ProblemBody {
    if (typeof response === 'object' && response !== null) {
      const candidate = response as Record<string, unknown>;
      if (typeof candidate.code === 'string' && typeof candidate.message === 'string') {
        return {
          code: candidate.code,
          message: candidate.message,
          ...(candidate.details === undefined ? {} : { details: candidate.details }),
        };
      }
    }

    const known = STATUS_PROBLEMS[status];
    if (known) {
      // An exception thrown with a bare string message means that wording was chosen
      // on purpose; keep it, but pair it with the stable code for the status.
      return typeof response === 'string' ? { code: known.code, message: response } : known;
    }

    return {
      code: 'request_failed',
      message: typeof response === 'string' ? response : `${status}: that request failed.`,
    };
  }
}
