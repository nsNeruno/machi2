CREATE TABLE "admin_sessions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "admin_user_id" uuid NOT NULL REFERENCES "admin_users"("id") ON DELETE cascade,
  "token_hash" text NOT NULL,
  "csrf_token" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "admin_sessions_token_hash_unique" ON "admin_sessions" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "admin_sessions_admin_user_idx" ON "admin_sessions" USING btree ("admin_user_id");
