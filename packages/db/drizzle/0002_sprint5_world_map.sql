CREATE TABLE IF NOT EXISTS "bms"."map_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"site_name" varchar(255),
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"capacity_mw" integer,
	"station_type" varchar(32),
	"station_category" varchar(64),
	"province" varchar(64),
	"station_operating_status" varchar(16),
	"meta" jsonb,
	CONSTRAINT "map_locations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "map_locations_site_name_idx" ON "bms"."map_locations" ("site_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "map_locations_kind_idx" ON "bms"."map_locations" ("kind");
