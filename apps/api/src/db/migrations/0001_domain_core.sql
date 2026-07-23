CREATE TABLE "admin_users" (
  "id" uuid PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "password_hash" text NOT NULL,
  "role" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "admin_users_role_check" CHECK ("role" IN ('superadmin', 'operator'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_email_unique" ON "admin_users" USING btree ("email");
--> statement-breakpoint
CREATE TABLE "locations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "address" text,
  "timezone" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "staff_pin_hash" text,
  "require_approval_for_others" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "locations_slug_unique" ON "locations" USING btree ("slug");
--> statement-breakpoint
CREATE TABLE "games" (
  "id" uuid PRIMARY KEY NOT NULL,
  "location_id" uuid NOT NULL REFERENCES "locations"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "cabinet_label" text,
  "queue_strategy" text DEFAULT 'simple_fifo' NOT NULL,
  "board_mode" text DEFAULT 'self_serve' NOT NULL,
  "max_queue_len" integer,
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "community_note" text,
  "community_note_visible" boolean DEFAULT false NOT NULL,
  "community_note_updated_at" timestamp with time zone,
  "community_note_updated_by" uuid REFERENCES "admin_users"("id") ON DELETE set null,
  CONSTRAINT "games_queue_strategy_check" CHECK ("queue_strategy" = 'simple_fifo'),
  CONSTRAINT "games_board_mode_check" CHECK ("board_mode" IN ('self_serve', 'now_playing')),
  CONSTRAINT "games_max_queue_len_check" CHECK ("max_queue_len" IS NULL OR "max_queue_len" > 0)
);
--> statement-breakpoint
CREATE INDEX "games_location_sort_order_idx" ON "games" USING btree ("location_id", "sort_order");
--> statement-breakpoint
CREATE UNIQUE INDEX "games_location_name_cabinet_unique" ON "games" USING btree ("location_id", "name", "cabinet_label");
--> statement-breakpoint
CREATE TABLE "admin_location_grants" (
  "admin_user_id" uuid NOT NULL REFERENCES "admin_users"("id") ON DELETE cascade,
  "location_id" uuid NOT NULL REFERENCES "locations"("id") ON DELETE cascade,
  PRIMARY KEY ("admin_user_id", "location_id")
);
--> statement-breakpoint
CREATE TABLE "queue_entries" (
  "id" uuid PRIMARY KEY NOT NULL,
  "game_id" uuid NOT NULL REFERENCES "games"("id") ON DELETE cascade,
  "location_id" uuid NOT NULL REFERENCES "locations"("id") ON DELETE cascade,
  "service_date" date NOT NULL,
  "ticket_number" integer NOT NULL,
  "display_name" text NOT NULL,
  "status" text DEFAULT 'waiting' NOT NULL,
  "done_reason" text,
  "auto_requeue" boolean DEFAULT false NOT NULL,
  "requeued_from" uuid REFERENCES "queue_entries"("id") ON DELETE set null,
  "device_token_hash" text NOT NULL,
  "done_by_token_hash" text,
  "done_by_name" text,
  "done_by_role" text,
  "ip_hash" text NOT NULL,
  "idempotency_key" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "done_at" timestamp with time zone,
  CONSTRAINT "queue_entries_ticket_number_check" CHECK ("ticket_number" > 0),
  CONSTRAINT "queue_entries_status_check" CHECK ("status" IN ('waiting', 'done')),
  CONSTRAINT "queue_entries_done_reason_check" CHECK ("done_reason" IS NULL OR "done_reason" IN ('played', 'left', 'skipped', 'other')),
  CONSTRAINT "queue_entries_done_role_check" CHECK ("done_by_role" IS NULL OR "done_by_role" IN ('self', 'player', 'staff', 'admin', 'system'))
);
--> statement-breakpoint
CREATE INDEX "queue_entries_hot_read_idx" ON "queue_entries" USING btree ("game_id", "service_date", "status", "ticket_number");
--> statement-breakpoint
CREATE UNIQUE INDEX "queue_entries_game_service_ticket_unique" ON "queue_entries" USING btree ("game_id", "service_date", "ticket_number");
--> statement-breakpoint
CREATE UNIQUE INDEX "queue_entries_game_service_idempotency_unique" ON "queue_entries" USING btree ("game_id", "service_date", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "queue_entries_one_waiting_device_unique" ON "queue_entries" USING btree ("game_id", "service_date", "device_token_hash") WHERE "status" = 'waiting';
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
  "id" uuid PRIMARY KEY NOT NULL,
  "scope" text NOT NULL,
  "key" text NOT NULL,
  "response_json" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_records_scope_key_unique" ON "idempotency_records" USING btree ("scope", "key");
