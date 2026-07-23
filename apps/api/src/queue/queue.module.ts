import { Module } from '@nestjs/common';

import { LocationsModule } from '../locations/locations.module';
import { GamesQueueController, QueueEntriesController } from './queue.controller';
import { QueueEventsModule } from './queue-events.module';
import { QueueService } from './queue.service';
import { QueueStrategyRegistry } from './strategies/queue-strategy.registry';
import { SimpleFifoStrategy } from './strategies/simple-fifo.strategy';

@Module({
  imports: [LocationsModule, QueueEventsModule],
  controllers: [GamesQueueController, QueueEntriesController],
  providers: [QueueService, QueueStrategyRegistry, SimpleFifoStrategy],
})
export class QueueModule {}
