CREATE TABLE "app_meta" (
  "key" text PRIMARY KEY NOT NULL,
  "value" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "app_meta" ("key", "value")
VALUES ('schema_version', '0')
ON CONFLICT ("key") DO NOTHING;

