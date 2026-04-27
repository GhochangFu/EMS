CREATE TABLE IF NOT EXISTS "bms"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"role" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bms"."assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"site_name" varchar(255) NOT NULL,
	"domain" varchar(64) DEFAULT 'electrical' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bms"."alarms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"severity" varchar(32) NOT NULL,
	"message" text NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bms"."alarms" ADD CONSTRAINT "alarms_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "bms"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bms"."alarms" ADD CONSTRAINT "alarms_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "bms"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "telemetry"."point_values" (
	"time" timestamp with time zone NOT NULL,
	"asset_id" uuid NOT NULL,
	"point_key" varchar(128) NOT NULL,
	"value" double precision NOT NULL,
	"unit" varchar(32),
	CONSTRAINT "point_values_time_asset_id_point_key_pk" PRIMARY KEY("time","asset_id","point_key")
);
--> statement-breakpoint
SELECT public.create_hypertable(
  'telemetry.point_values',
  'time',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE
);
