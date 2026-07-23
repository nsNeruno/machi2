import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

import { AdminModule } from './admin/admin.module';
import { CommonModule } from './common/common.module';
import { getEnvironment } from './config/environment';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { LocationsModule } from './locations/locations.module';
import { QueueModule } from './queue/queue.module';

const env = getEnvironment();

@Module({
  imports: [
    ThrottlerModule.forRoot([
      { name: 'read', ttl: env.readIpTtlMs, limit: env.readIpLimit },
      { name: 'enqueue', ttl: env.enqueueIpTtlMs, limit: env.enqueueIpLimit },
      { name: 'complete', ttl: 60_000, limit: 10 },
      { name: 'auth', ttl: 60_000, limit: 10 },
    ]),
    CommonModule,
    DbModule,
    HealthModule,
    LocationsModule,
    QueueModule,
    AdminModule,
  ],
})
export class AppModule {}
