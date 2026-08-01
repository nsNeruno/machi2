import { Module } from '@nestjs/common';

import { QueueEventsModule } from '../queue/queue-events.module';
import { LocationValidationService } from './location-validation.service';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

@Module({
  imports: [QueueEventsModule],
  controllers: [LocationsController],
  providers: [LocationsService, LocationValidationService],
  exports: [LocationsService, LocationValidationService],
})
export class LocationsModule {}
