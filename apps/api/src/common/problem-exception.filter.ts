import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

type ProblemBody = {
  code: string;
  message: string;
  details?: unknown;
};

@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const body = this.toProblemBody(response, exception.getStatus());
      reply.status(exception.getStatus()).send(body);
      return;
    }

    this.logger.error(exception);
    reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      code: 'internal_error',
      message: 'An unexpected error occurred.',
    } satisfies ProblemBody);
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

    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      return {
        code: 'rate_limited',
        message: 'You are sending requests too quickly. Wait a few seconds and try again.',
      };
    }

    return {
      code: 'request_failed',
      message: typeof response === 'string' ? response : 'Request failed.',
    };
  }
}
