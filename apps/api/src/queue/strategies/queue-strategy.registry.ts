import { Injectable, InternalServerErrorException } from '@nestjs/common';

import { SimpleFifoStrategy } from './simple-fifo.strategy';
import type { QueueStrategy } from './queue-strategy.interface';

@Injectable()
export class QueueStrategyRegistry {
  constructor(private readonly simpleFifoStrategy: SimpleFifoStrategy) {}

  resolve(key: string): QueueStrategy {
    if (key === this.simpleFifoStrategy.key) {
      return this.simpleFifoStrategy;
    }

    throw new InternalServerErrorException({
      code: 'unsupported_queue_strategy',
      message: 'This game has an unsupported queue strategy.',
    });
  }
}
