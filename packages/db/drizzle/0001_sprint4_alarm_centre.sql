ALTER TABLE "bms"."alarms" ADD COLUMN IF NOT EXISTS "rule_key" varchar(64);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bms"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" varchar(64) NOT NULL,
	"entity_type" varchar(64) NOT NULL,
	"entity_id" uuid,
	"reason" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bms"."audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "bms"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_entity_idx" ON "bms"."audit_log" ("entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_created_idx" ON "bms"."audit_log" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alarms_open_rule_idx" ON "bms"."alarms" ("asset_id", "rule_key") WHERE "acknowledged_at" IS NULL AND "rule_key" IS NOT NULL;
