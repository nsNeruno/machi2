ALTER TABLE "locations" ADD COLUMN "latitude" double precision;
--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "longitude" double precision;
--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "location_validation_radius_meters" integer DEFAULT 5 NOT NULL;
--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_coordinates_pair_check" CHECK (("latitude" IS NULL AND "longitude" IS NULL) OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_latitude_range_check" CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90);
--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_longitude_range_check" CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180);
--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_validation_radius_check" CHECK ("location_validation_radius_meters" > 0);
