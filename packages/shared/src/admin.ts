import { z } from 'zod';

import { nameSchema } from './name';
import { boardModeSchema, doneReasonSchema, queueEntryResponseSchema } from './queue';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export const adminRoleSchema = z.enum(['superadmin', 'operator']);
export type AdminRole = z.infer<typeof adminRoleSchema>;

export const slugSchema = z
  .string()
  .trim()
  .min(1, 'Enter a slug')
  .max(64, 'Slug is too long')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and single hyphens');

export const timezoneSchema = z
  .string()
  .trim()
  .min(1, 'Choose a timezone')
  .max(64, 'Timezone is too long')
  .refine(isValidTimeZone, 'Choose a valid IANA timezone');

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Suggest a URL-safe slug from a free-text name. */
export function suggestSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email').max(254);
const passwordSchema = z.string().min(10, 'Use at least 10 characters').max(256);
const staffPinSchema = z.string().trim().min(4, 'PIN must be at least 4 characters').max(64);
const locationNameSchema = z.string().trim().min(1, 'Enter a name').max(120);
const addressSchema = z.string().trim().max(240).optional().nullable();
const gameNameSchema = z.string().trim().min(1, 'Enter a name').max(120);
const cabinetLabelSchema = z.string().trim().max(80).optional().nullable();
const maxQueueLenSchema = z.number().int().positive().max(9999).optional().nullable();
const noteBodySchema = z.string().max(2000);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const adminLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
});
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

export const adminMeResponseSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: adminRoleSchema,
  grantedLocationIds: z.array(z.uuid()),
  csrfToken: z.string(),
});
export type AdminMeResponse = z.infer<typeof adminMeResponseSchema>;

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export const adminLocationResponseSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  timezone: z.string(),
  isActive: z.boolean(),
  requireApprovalForOthers: z.boolean(),
  hasStaffPin: z.boolean(),
  gameCount: z.number().int().nonnegative(),
});
export type AdminLocationResponse = z.infer<typeof adminLocationResponseSchema>;

export const adminLocationsResponseSchema = z.array(adminLocationResponseSchema);

export const adminLocationCreateSchema = z
  .object({
    name: locationNameSchema,
    slug: slugSchema,
    address: addressSchema,
    timezone: timezoneSchema,
    isActive: z.boolean().default(true),
    requireApprovalForOthers: z.boolean().default(false),
    staffPin: staffPinSchema.optional(),
  })
  .refine((value) => !value.requireApprovalForOthers || Boolean(value.staffPin), {
    message: 'A staff PIN is required when approval is on',
    path: ['staffPin'],
  });
export type AdminLocationCreateInput = z.infer<typeof adminLocationCreateSchema>;

export const adminLocationUpdateSchema = z.object({
  name: locationNameSchema.optional(),
  slug: slugSchema.optional(),
  address: addressSchema,
  timezone: timezoneSchema.optional(),
  isActive: z.boolean().optional(),
  requireApprovalForOthers: z.boolean().optional(),
  // Empty string clears the PIN; omitted leaves it unchanged; a value replaces it.
  staffPin: z.union([staffPinSchema, z.literal('')]).optional(),
});
export type AdminLocationUpdateInput = z.infer<typeof adminLocationUpdateSchema>;

export const slugAvailabilityResponseSchema = z.object({
  slug: z.string(),
  available: z.boolean(),
});
export type SlugAvailabilityResponse = z.infer<typeof slugAvailabilityResponseSchema>;

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

export const adminGameResponseSchema = z.object({
  id: z.uuid(),
  locationId: z.uuid(),
  name: z.string(),
  cabinetLabel: z.string().nullable(),
  queueStrategy: z.string(),
  boardMode: boardModeSchema,
  maxQueueLen: z.number().int().positive().nullable(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  communityNote: z.string().nullable(),
  communityNoteVisible: z.boolean(),
  communityNoteUpdatedAt: z.string().datetime().nullable(),
  communityNoteUpdatedByName: z.string().nullable(),
});
export type AdminGameResponse = z.infer<typeof adminGameResponseSchema>;

export const adminGamesResponseSchema = z.array(adminGameResponseSchema);

export const adminGameCreateSchema = z.object({
  name: gameNameSchema,
  cabinetLabel: cabinetLabelSchema,
  boardMode: boardModeSchema.default('self_serve'),
  maxQueueLen: maxQueueLenSchema,
  isActive: z.boolean().default(true),
});
export type AdminGameCreateInput = z.infer<typeof adminGameCreateSchema>;

export const adminGameUpdateSchema = z.object({
  name: gameNameSchema.optional(),
  cabinetLabel: cabinetLabelSchema,
  boardMode: boardModeSchema.optional(),
  maxQueueLen: maxQueueLenSchema,
  isActive: z.boolean().optional(),
});
export type AdminGameUpdateInput = z.infer<typeof adminGameUpdateSchema>;

export const adminGameReorderSchema = z.object({
  order: z.array(z.uuid()).min(1),
});
export type AdminGameReorderInput = z.infer<typeof adminGameReorderSchema>;

export const adminCommunityNoteSchema = z.object({
  body: noteBodySchema,
  visible: z.boolean(),
});
export type AdminCommunityNoteInput = z.infer<typeof adminCommunityNoteSchema>;

// ---------------------------------------------------------------------------
// Live queue (admin)
// ---------------------------------------------------------------------------

export const adminQueueEntryResponseSchema = queueEntryResponseSchema.extend({
  // The admin console always resolves the acting device's self-asserted name where present.
  doneByName: z.string().nullable(),
});
export type AdminQueueEntryResponse = z.infer<typeof adminQueueEntryResponseSchema>;

export const adminQueueBoardResponseSchema = z.object({
  game: z.object({
    id: z.uuid(),
    name: z.string(),
    cabinetLabel: z.string().nullable(),
  }),
  locationId: z.uuid(),
  serviceDate: z.string().date(),
  locationTimezone: z.string(),
  boardMode: boardModeSchema,
  entries: z.array(adminQueueEntryResponseSchema),
});
export type AdminQueueBoardResponse = z.infer<typeof adminQueueBoardResponseSchema>;

const adminQueueStreamBaseSchema = z.object({
  gameId: z.uuid(),
  occurredAt: z.string().datetime(),
});

export const adminQueueStreamEventSchema = z.discriminatedUnion('type', [
  adminQueueStreamBaseSchema.extend({ type: z.literal('connected') }),
  adminQueueStreamBaseSchema.extend({ type: z.literal('heartbeat') }),
  adminQueueStreamBaseSchema.extend({
    type: z.literal('queue-updated'),
    serviceDate: z.string().date(),
    board: adminQueueBoardResponseSchema,
  }),
  adminQueueStreamBaseSchema.extend({
    type: z.literal('day-rollover'),
    serviceDate: z.string().date(),
    board: adminQueueBoardResponseSchema,
  }),
]);
export type AdminQueueStreamEvent = z.infer<typeof adminQueueStreamEventSchema>;

export const adminMarkDoneSchema = z.object({
  reason: doneReasonSchema,
});
export type AdminMarkDoneInput = z.infer<typeof adminMarkDoneSchema>;

export const adminClearQueueResponseSchema = z.object({
  removed: z.number().int().nonnegative(),
});
export type AdminClearQueueResponse = z.infer<typeof adminClearQueueResponseSchema>;

// ---------------------------------------------------------------------------
// Admin users & grants (superadmin only)
// ---------------------------------------------------------------------------

export const adminUserResponseSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: adminRoleSchema,
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  grantedLocationIds: z.array(z.uuid()),
});
export type AdminUserResponse = z.infer<typeof adminUserResponseSchema>;

export const adminUsersResponseSchema = z.array(adminUserResponseSchema);

export const adminUserCreateSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  role: adminRoleSchema,
  grantedLocationIds: z.array(z.uuid()).default([]),
});
export type AdminUserCreateInput = z.infer<typeof adminUserCreateSchema>;

export const adminUserUpdateSchema = z.object({
  role: adminRoleSchema.optional(),
  isActive: z.boolean().optional(),
});
export type AdminUserUpdateInput = z.infer<typeof adminUserUpdateSchema>;

export const adminGrantsSchema = z.object({
  locationIds: z.array(z.uuid()),
});
export type AdminGrantsInput = z.infer<typeof adminGrantsSchema>;

export const adminPasswordSchema = z.object({
  password: passwordSchema,
});
export type AdminPasswordInput = z.infer<typeof adminPasswordSchema>;

// Re-export name schema usage marker so tree-shaking keeps the dependency explicit.
export { nameSchema };
