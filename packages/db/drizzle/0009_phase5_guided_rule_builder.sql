ALTER TABLE "bms"."automation_rules"
ADD COLUMN IF NOT EXISTS "lifecycle_status" varchar(32) DEFAULT 'published' NOT NULL;
--> statement-breakpoint
ALTER TABLE "bms"."automation_rules"
ADD COLUMN IF NOT EXISTS "published_at" timestamptz DEFAULT now();
--> statement-breakpoint
ALTER TABLE "bms"."automation_rules"
ADD COLUMN IF NOT EXISTS "archived_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "bms"."automation_rules"
ADD COLUMN IF NOT EXISTS "duplicated_from_rule_id" uuid;
--> statement-breakpoint
UPDATE "bms"."automation_rules"
SET "lifecycle_status" = 'published',
    "published_at" = COALESCE("published_at", "created_at")
WHERE "lifecycle_status" IS NULL OR "lifecycle_status" = '';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_rules_lifecycle_idx"
ON "bms"."automation_rules" ("lifecycle_status", "enabled", "category");
