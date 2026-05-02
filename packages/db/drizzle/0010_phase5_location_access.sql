CREATE TABLE IF NOT EXISTS "bms"."locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(64) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(32) NOT NULL,
	"province" varchar(64),
	"capital" varchar(128),
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_code_unique" UNIQUE("code"),
	CONSTRAINT "locations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "bms"."users" ADD COLUMN IF NOT EXISTS "oidc_subject" varchar(255);
--> statement-breakpoint
ALTER TABLE "bms"."users" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "bms"."assets" ADD COLUMN IF NOT EXISTS "location_id" uuid;
--> statement-breakpoint
ALTER TABLE "bms"."assets" ADD COLUMN IF NOT EXISTS "meta" jsonb;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bms"."assets" ADD CONSTRAINT "assets_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "bms"."locations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bms"."asset_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bms"."asset_groups" ADD CONSTRAINT "asset_groups_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "bms"."locations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_groups_location_code_idx" ON "bms"."asset_groups" ("location_id","code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bms"."asset_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_group_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bms"."asset_group_members" ADD CONSTRAINT "asset_group_members_asset_group_id_asset_groups_id_fk" FOREIGN KEY ("asset_group_id") REFERENCES "bms"."asset_groups"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bms"."asset_group_members" ADD CONSTRAINT "asset_group_members_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "bms"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_group_members_group_asset_idx" ON "bms"."asset_group_members" ("asset_group_id","asset_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bms"."user_location_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bms"."user_location_access" ADD CONSTRAINT "user_location_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "bms"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bms"."user_location_access" ADD CONSTRAINT "user_location_access_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "bms"."locations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_location_access_user_location_idx" ON "bms"."user_location_access" ("user_id","location_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bms"."user_asset_group_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"asset_group_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bms"."user_asset_group_access" ADD CONSTRAINT "user_asset_group_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "bms"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bms"."user_asset_group_access" ADD CONSTRAINT "user_asset_group_access_asset_group_id_asset_groups_id_fk" FOREIGN KEY ("asset_group_id") REFERENCES "bms"."asset_groups"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_asset_group_access_user_group_idx" ON "bms"."user_asset_group_access" ("user_id","asset_group_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_location_id_idx" ON "bms"."assets" ("location_id");
