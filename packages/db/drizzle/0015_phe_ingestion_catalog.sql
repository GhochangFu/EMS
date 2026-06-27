CREATE TABLE IF NOT EXISTS "bms"."ingestion_gateways" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"external_rtu_id" integer NOT NULL,
	"rtu_code" varchar(64) NOT NULL,
	"mqtt_topic" varchar(255) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"station_code" varchar(64),
	"station_name" varchar(255),
	"ingest_enabled" boolean DEFAULT false NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingestion_gateways_mqtt_topic_unique" UNIQUE("mqtt_topic")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bms"."ingestion_gateways" ADD CONSTRAINT "ingestion_gateways_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "bms"."locations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ingestion_gateways_external_rtu_idx" ON "bms"."ingestion_gateways" ("external_rtu_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bms"."asset_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"point_key" varchar(128) NOT NULL,
	"source_data_key" varchar(128) NOT NULL,
	"sensor_code" varchar(64),
	"unit" varchar(32),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_points_asset_id_point_key_unique" UNIQUE("asset_id","point_key")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bms"."asset_points" ADD CONSTRAINT "asset_points_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "bms"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_points_asset_source_key_idx" ON "bms"."asset_points" ("asset_id","source_data_key");
