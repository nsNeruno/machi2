import { z } from 'zod';

export const loadLevelSchema = z.enum(['normal', 'elevated', 'shed', 'maintenance']);
export type LoadLevel = z.infer<typeof loadLevelSchema>;

/** Levels ordered by severity, so callers can compare with an index. */
export const loadLevelOrder: LoadLevel[] = ['normal', 'elevated', 'shed', 'maintenance'];

export const governorStatusSchema = z.object({
  level: loadLevelSchema,
  // The level chosen from live signals, before any manual override is applied.
  autoLevel: loadLevelSchema,
  manualLevel: loadLevelSchema.nullable(),
  reason: z.string().nullable(),
  signals: z.object({
    requestsPerSecond: z.number().nonnegative(),
    enqueuesPerSecond: z.number().nonnegative(),
    openStreams: z.number().int().nonnegative(),
    rssMb: z.number().nonnegative(),
    eventLoopLagMs: z.number().nonnegative(),
  }),
  updatedAt: z.string().datetime(),
});
export type GovernorStatus = z.infer<typeof governorStatusSchema>;

export const maintenanceOverrideSchema = z.object({
  // null clears a manual override and returns control to the automatic governor.
  level: loadLevelSchema.nullable(),
  reason: z.string().trim().max(280).optional(),
});
export type MaintenanceOverrideInput = z.infer<typeof maintenanceOverrideSchema>;

/** Writes are shed at these levels; reads always serve so the queue stays viewable. */
export function writesAreShed(level: LoadLevel): boolean {
  return level === 'shed' || level === 'maintenance';
}
