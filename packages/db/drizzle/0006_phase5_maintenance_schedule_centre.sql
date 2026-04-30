ALTER TABLE "bms"."maintenance_task_templates"
ADD COLUMN IF NOT EXISTS "category" varchar(64) DEFAULT 'preventive' NOT NULL;
--> statement-breakpoint
ALTER TABLE "bms"."maintenance_task_templates"
ADD COLUMN IF NOT EXISTS "generation_mode" varchar(32) DEFAULT 'calendar' NOT NULL;
--> statement-breakpoint
ALTER TABLE "bms"."maintenance_task_templates"
ADD COLUMN IF NOT EXISTS "owner_team" varchar(128);
--> statement-breakpoint
ALTER TABLE "bms"."maintenance_task_templates"
ADD COLUMN IF NOT EXISTS "vendor_name" varchar(128);
--> statement-breakpoint
ALTER TABLE "bms"."maintenance_task_templates"
ADD COLUMN IF NOT EXISTS "compliance_ref" varchar(128);
--> statement-breakpoint
ALTER TABLE "bms"."maintenance_task_templates"
ADD COLUMN IF NOT EXISTS "trigger_summary" text;
--> statement-breakpoint
ALTER TABLE "bms"."maintenance_task_templates"
ADD COLUMN IF NOT EXISTS "safety_critical" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maintenance_task_templates_category_idx"
ON "bms"."maintenance_task_templates" ("category", "active");
