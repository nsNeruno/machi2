import type { QueueEntryResponse } from '@machi2/shared';

import { queueEntries } from '../db/schema';

export function toQueueEntryResponse(
  entry: typeof queueEntries.$inferSelect,
  actorTokenHash: string | undefined,
  roundNumber: number,
): QueueEntryResponse {
  return {
    id: entry.id,
    ticketNumber: entry.ticketNumber,
    displayName: entry.displayName,
    status: entry.status,
    doneReason: entry.doneReason ?? null,
    autoRequeue: entry.autoRequeue,
    mine: actorTokenHash === entry.deviceTokenHash,
    createdAt: entry.createdAt.toISOString(),
    doneAt: entry.doneAt?.toISOString() ?? null,
    doneByName: entry.doneByName ?? null,
    doneByRole: entry.doneByRole ?? null,
    roundNumber,
  };
}
