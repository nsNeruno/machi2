import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { DeviceTokenService } from './device-token.service';
import { LoadGovernorService } from './load-governor.service';
import { LoadSignalInterceptor } from './load-signal.interceptor';
import { PublicWriteRateLimiterService } from './public-write-rate-limiter.service';
import { ServiceDateService } from './service-date.service';
import { QueueEventsModule } from '../queue/queue-events.module';

@Global()
@Module({
  imports: [QueueEventsModule],
  providers: [
    DeviceTokenService,
    PublicWriteRateLimiterService,
    ServiceDateService,
    LoadGovernorService,
    { provide: APP_INTERCEPTOR, useClass: LoadSignalInterceptor },
  ],
  exports: [DeviceTokenService, PublicWriteRateLimiterService, ServiceDateService, LoadGovernorService],
})
export class CommonModule {}
