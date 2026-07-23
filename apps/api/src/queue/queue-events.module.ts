import { Module } from '@nestjs/common';

import { DbModule } from '../db/db.module';
import { QueueEventsService } from './queue-events.service';

@Module({
  imports: [DbModule],
  providers: [QueueEventsService],
  exports: [QueueEventsService],
})
export class QueueEventsModule {}
