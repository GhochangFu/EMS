CREATE TABLE IF NOT EXISTS "bms"."organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_code_unique" UNIQUE("code")
);
--> statement-breakpoint
INSERT INTO "bms"."organizations" ("code", "name", "meta")
VALUES
	('ESKOM', 'Eskom SMOC', '{"tenant":"demo"}'::jsonb),
	('PHEWB', 'Public Health Engineering — West Bengal', '{"orgId":10}'::jsonb)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "bms"."locations" ADD COLUMN IF NOT EXISTS "organization_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bms"."locations" ADD CONSTRAINT "locations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "bms"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
UPDATE "bms"."locations" AS l
SET "organization_id" = o.id
FROM "bms"."organizations" AS o
WHERE l.organization_id IS NULL
  AND l.slug LIKE 'phe-%'
  AND o.code = 'PHEWB';
--> statement-breakpoint
UPDATE "bms"."locations" AS l
SET "organization_id" = o.id
FROM "bms"."organizations" AS o
WHERE l.organization_id IS NULL
  AND o.code = 'ESKOM';
--> statement-breakpoint
ALTER TABLE "bms"."locations" DROP CONSTRAINT IF EXISTS "locations_code_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "locations_org_code_idx" ON "bms"."locations" ("organization_id", "code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bms"."rtus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"code" varchar(64) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"source_type" varchar(32) DEFAULT 'catalog' NOT NULL,
	"domain" varchar(64),
	"external_rtu_id" integer,
	"rtu_code" varchar(64),
	"mqtt_topic" varchar(255),
	"station_code" varchar(64),
	"station_name" varchar(255),
	"ingest_enabled" boolean DEFAULT false NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rtus_location_code_unique" UNIQUE("location_id", "code")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bms"."rtus" ADD CONSTRAINT "rtus_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "bms"."locations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rtus_mqtt_topic_idx" ON "bms"."rtus" ("mqtt_topic") WHERE "mqtt_topic" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rtus_external_rtu_idx" ON "bms"."rtus" ("external_rtu_id") WHERE "external_rtu_id" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "bms"."rtus" (
	"location_id",
	"code",
	"display_name",
	"source_type",
	"external_rtu_id",
	"rtu_code",
	"mqtt_topic",
	"station_code",
	"station_name",
	"ingest_enabled",
	"meta"
)
SELECT
	ig.location_id,
	'RTU-' || ig.rtu_code,
	ig.display_name,
	CASE WHEN ig.ingest_enabled THEN 'mqtt' ELSE 'catalog' END,
	ig.external_rtu_id,
	ig.rtu_code,
	ig.mqtt_topic,
	ig.station_code,
	ig.station_name,
	ig.ingest_enabled,
	ig.meta
FROM "bms"."ingestion_gateways" AS ig
WHERE NOT EXISTS (
	SELECT 1 FROM "bms"."rtus" AS r
	WHERE r.mqtt_topic IS NOT NULL AND r.mqtt_topic = ig.mqtt_topic
);
--> statement-breakpoint
ALTER TABLE "bms"."assets" ADD COLUMN IF NOT EXISTS "rtu_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bms"."assets" ADD CONSTRAINT "assets_rtu_id_rtus_id_fk" FOREIGN KEY ("rtu_id") REFERENCES "bms"."rtus"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
UPDATE "bms"."assets" AS a
SET "rtu_id" = r.id
FROM "bms"."rtus" AS r
WHERE a.rtu_id IS NULL
  AND a.location_id = r.location_id
  AND a.meta IS NOT NULL
  AND COALESCE(a.meta->>'telemetrySource', '') IN ('mqtt', 'catalog')
  AND (a.meta->'phe'->>'edgeRtuId')::int = r.external_rtu_id;
--> statement-breakpoint
DROP TABLE IF EXISTS "bms"."ingestion_gateways";
