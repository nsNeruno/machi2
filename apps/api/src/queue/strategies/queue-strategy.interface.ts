import type {
  CompleteQueueEntryResponse,
  DoneReason,
  EnqueueResponse,
  QueueScope,
} from '@machi2/shared';

import type { DeviceActor } from '../../common/device-token.service';
import type { queueEntries } from '../../db/schema';
import type { QueueContext } from '../../locations/locations.service';

export type EnqueueInput = {
  displayName: string;
  autoRequeue: boolean;
  actor: DeviceActor;
  idempotencyKey: string;
};

export type CompleteInput = {
  reason: DoneReason;
  actingName?: string;
  staffPin?: string;
  actor: DeviceActor;
  idempotencyKey: string;
};

export interface QueueStrategy {
  readonly key: string;
  enqueue(context: QueueContext, input: EnqueueInput): Promise<EnqueueResponse>;
  complete(
    context: QueueContext,
    entryId: string,
    input: CompleteInput,
  ): Promise<CompleteQueueEntryResponse>;
  list(context: QueueContext, scope: QueueScope): Promise<Array<typeof queueEntries.$inferSelect>>;
}
