import { z } from 'zod';

import { locationPositionSchema, locationValidationResponseSchema } from './location';
import { nameSchema } from './name';

export const queueStatusSchema = z.enum(['waiting', 'done']);
export const doneReasonSchema = z.enum(['played', 'left', 'skipped', 'other']);
export const doneByRoleSchema = z.enum(['self', 'player', 'staff', 'admin', 'system']);
export const boardModeSchema = z.enum(['self_serve', 'now_playing']);
export const queueScopeSchema = z.enum(['recent', 'all']);

export type QueueStatus = z.infer<typeof queueStatusSchema>;
export type DoneReason = z.infer<typeof doneReasonSchema>;
export type DoneByRole = z.infer<typeof doneByRoleSchema>;
export type BoardMode = z.infer<typeof boardModeSchema>;
export type QueueScope = z.infer<typeof queueScopeSchema>;

export const gameSummaryResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  cabinetLabel: z.string().nullable(),
  boardMode: boardModeSchema,
  isActive: z.boolean(),
  waitingCount: z.number().int().nonnegative(),
});

export const locationSummaryResponseSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  timezone: z.string(),
  isActive: z.boolean(),
});

export const locationsResponseSchema = z.array(locationSummaryResponseSchema);

export const locationDetailResponseSchema = locationSummaryResponseSchema.extend({
  games: z.array(gameSummaryResponseSchema),
});

export type GameSummaryResponse = z.infer<typeof gameSummaryResponseSchema>;
export type LocationSummaryResponse = z.infer<typeof locationSummaryResponseSchema>;
export type LocationDetailResponse = z.infer<typeof locationDetailResponseSchema>;

export const enqueueQueueSchema = z.object({
  displayName: nameSchema,
  autoRequeue: z.boolean().default(false),
  position: locationPositionSchema.optional(),
});

export const completeQueueEntrySchema = z.object({
  reason: doneReasonSchema,
  actingName: nameSchema.optional(),
  staffPin: z.string().min(1).max(128).optional(),
  position: locationPositionSchema.optional(),
});

export const queueEntryResponseSchema = z.object({
  id: z.uuid(),
  ticketNumber: z.number().int().positive(),
  displayName: z.string(),
  status: queueStatusSchema,
  doneReason: doneReasonSchema.nullable(),
  autoRequeue: z.boolean(),
  mine: z.boolean(),
  createdAt: z.string().datetime(),
  doneAt: z.string().datetime().nullable(),
  doneByName: z.string().nullable(),
  doneByRole: doneByRoleSchema.nullable(),
  roundNumber: z.number().int().positive(),
});

export type QueueEntryResponse = z.infer<typeof queueEntryResponseSchema>;

export const queueBoardResponseSchema = z.object({
  game: z.object({
    id: z.uuid(),
    name: z.string(),
    cabinetLabel: z.string().nullable(),
  }),
  serviceDate: z.string().date(),
  locationTimezone: z.string(),
  boardMode: boardModeSchema,
  requireApprovalForOthers: z.boolean(),
  locationValidation: locationValidationResponseSchema,
  communityNote: z
    .object({
      body: z.string(),
      updatedAt: z.string().datetime().nullable(),
    })
    .nullable(),
  entries: z.array(queueEntryResponseSchema),
});

export type QueueBoardResponse = z.infer<typeof queueBoardResponseSchema>;

export const enqueueResponseSchema = z.object({
  entry: queueEntryResponseSchema,
});

export type EnqueueResponse = z.infer<typeof enqueueResponseSchema>;

export const completeQueueEntryResponseSchema = z.object({
  entry: queueEntryResponseSchema,
  requeuedEntry: queueEntryResponseSchema.nullable(),
  autoRequeueSkipped: z.boolean(),
});

export type CompleteQueueEntryResponse = z.infer<typeof completeQueueEntryResponseSchema>;

const queueStreamSignalBaseSchema = z.object({
  gameId: z.uuid(),
  occurredAt: z.string().datetime(),
});

export const queueStreamSignalSchema = z.discriminatedUnion('type', [
  queueStreamSignalBaseSchema.extend({
    type: z.literal('connected'),
  }),
  queueStreamSignalBaseSchema.extend({
    type: z.literal('heartbeat'),
  }),
  queueStreamSignalBaseSchema.extend({
    type: z.literal('queue-updated'),
    serviceDate: z.string().date(),
  }),
  queueStreamSignalBaseSchema.extend({
    type: z.literal('day-rollover'),
    serviceDate: z.string().date(),
  }),
]);

export type QueueStreamSignal = z.infer<typeof queueStreamSignalSchema>;

export const queueStreamEventSchema = z.discriminatedUnion('type', [
  queueStreamSignalBaseSchema.extend({
    type: z.literal('connected'),
  }),
  queueStreamSignalBaseSchema.extend({
    type: z.literal('heartbeat'),
  }),
  queueStreamSignalBaseSchema.extend({
    type: z.literal('queue-updated'),
    serviceDate: z.string().date(),
    board: queueBoardResponseSchema,
  }),
  queueStreamSignalBaseSchema.extend({
    type: z.literal('day-rollover'),
    serviceDate: z.string().date(),
    board: queueBoardResponseSchema,
  }),
]);

export type QueueStreamEvent = z.infer<typeof queueStreamEventSchema>;

const locationStreamSignalBaseSchema = z.object({
  locationId: z.uuid(),
  occurredAt: z.string().datetime(),
});

export const locationStreamEventSchema = z.discriminatedUnion('type', [
  locationStreamSignalBaseSchema.extend({
    type: z.literal('connected'),
  }),
  locationStreamSignalBaseSchema.extend({
    type: z.literal('heartbeat'),
  }),
  locationStreamSignalBaseSchema.extend({
    type: z.literal('location-updated'),
    location: locationDetailResponseSchema,
  }),
]);

export type LocationStreamEvent = z.infer<typeof locationStreamEventSchema>;
