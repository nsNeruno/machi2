import fastifyStatic from '@fastify/static';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module';
import { ProblemExceptionFilter } from './common/problem-exception.filter';
import { spaDistExists, WEB_DIST_PATH } from './common/spa';
import { getEnvironment } from './config/environment';

async function bootstrap(): Promise<void> {
  const environment = getEnvironment();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: environment.trustProxy }),
  );

  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ProblemExceptionFilter());

  // Serves the built SPA (`apps/web/dist`) directly — one service, one origin, no
  // CORS (CLAUDE.md §3). Real static files (JS/CSS/icons) get served here; any other
  // path (e.g. a deep client route like `/admin/settings`) falls through to Nest's
  // own not-found handling, which `ProblemExceptionFilter` turns into the SPA's
  // `index.html` for browser requests — see common/spa.ts and common/not-found-page.ts.
  if (spaDistExists()) {
    await app.register(fastifyStatic, { root: WEB_DIST_PATH });
  } else {
    Logger.warn(
      `No build found at ${WEB_DIST_PATH} — serving API only (run "pnpm --filter @machi2/web build" to also serve the SPA)`,
      'Bootstrap',
    );
  }

  await app.listen({ port: environment.port, host: '0.0.0.0' });
  Logger.log(`API listening on port ${environment.port}`, 'Bootstrap');
}

void bootstrap();
