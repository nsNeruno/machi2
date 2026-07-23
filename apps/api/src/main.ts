import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module';
import { ProblemExceptionFilter } from './common/problem-exception.filter';
import { getEnvironment } from './config/environment';

async function bootstrap(): Promise<void> {
  const environment = getEnvironment();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: environment.trustProxy }),
  );

  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ProblemExceptionFilter());
  await app.listen({ port: environment.port, host: '0.0.0.0' });
  Logger.log(`API listening on port ${environment.port}`, 'Bootstrap');
}

void bootstrap();
