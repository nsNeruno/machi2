import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import type { BoardMode, DoneByRole, DoneReason, QueueStatus } from '@machi2/shared';

export const appMeta = pgTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const adminUsers = pgTable(
  'admin_users',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').$type<'superadmin' | 'operator'>().notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('admin_users_email_unique').on(table.email)],
);

export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: uuid('id').primaryKey(),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    csrfToken: text('csrf_token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('admin_sessions_token_hash_unique').on(table.tokenHash),
    index('admin_sessions_admin_user_idx').on(table.adminUserId),
  ],
);

export const locations = pgTable(
  'locations',
  {
    id: uuid('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    address: text('address'),
    timezone: text('timezone').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    staffPinHash: text('staff_pin_hash'),
    requireApprovalForOthers: boolean('require_approval_for_others').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('locations_slug_unique').on(table.slug)],
);

export const games = pgTable(
  'games',
  {
    id: uuid('id').primaryKey(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    cabinetLabel: text('cabinet_label'),
    queueStrategy: text('queue_strategy').default('simple_fifo').notNull(),
    boardMode: text('board_mode').$type<BoardMode>().default('self_serve').notNull(),
    maxQueueLen: integer('max_queue_len'),
    isActive: boolean('is_active').default(true).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    communityNote: text('community_note'),
    communityNoteVisible: boolean('community_note_visible').default(false).notNull(),
    communityNoteUpdatedAt: timestamp('community_note_updated_at', { withTimezone: true }),
    communityNoteUpdatedBy: uuid('community_note_updated_by').references(() => adminUsers.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    index('games_location_sort_order_idx').on(table.locationId, table.sortOrder),
    uniqueIndex('games_location_name_cabinet_unique').on(
      table.locationId,
      table.name,
      table.cabinetLabel,
    ),
  ],
);

export const adminLocationGrants = pgTable(
  'admin_location_grants',
  {
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.adminUserId, table.locationId] })],
);

export const queueEntries = pgTable(
  'queue_entries',
  {
    id: uuid('id').primaryKey(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    serviceDate: date('service_date').notNull(),
    ticketNumber: integer('ticket_number').notNull(),
    displayName: text('display_name').notNull(),
    status: text('status').$type<QueueStatus>().default('waiting').notNull(),
    doneReason: text('done_reason').$type<DoneReason>(),
    autoRequeue: boolean('auto_requeue').default(false).notNull(),
    requeuedFrom: uuid('requeued_from').references((): AnyPgColumn => queueEntries.id, {
      onDelete: 'set null',
    }),
    deviceTokenHash: text('device_token_hash').notNull(),
    doneByTokenHash: text('done_by_token_hash'),
    doneByName: text('done_by_name'),
    doneByRole: text('done_by_role').$type<DoneByRole>(),
    ipHash: text('ip_hash').notNull(),
    idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    doneAt: timestamp('done_at', { withTimezone: true }),
  },
  (table) => [
    index('queue_entries_hot_read_idx').on(
      table.gameId,
      table.serviceDate,
      table.status,
      table.ticketNumber,
    ),
    uniqueIndex('queue_entries_game_service_ticket_unique').on(
      table.gameId,
      table.serviceDate,
      table.ticketNumber,
    ),
    uniqueIndex('queue_entries_game_service_idempotency_unique')
      .on(table.gameId, table.serviceDate, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    uniqueIndex('queue_entries_one_waiting_device_unique')
      .on(table.gameId, table.serviceDate, table.deviceTokenHash)
      .where(sql`${table.status} = 'waiting'`),
  ],
);

export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    id: uuid('id').primaryKey(),
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    responseJson: jsonb('response_json').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('idempotency_records_scope_key_unique').on(table.scope, table.key)],
);
