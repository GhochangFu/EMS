CREATE TABLE IF NOT EXISTS "bms"."automation_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(64) NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text,
  "category" varchar(64) DEFAULT 'operations' NOT NULL,
  "rule_type" varchar(32) NOT NULL,
  "source" varchar(64) DEFAULT 'operator_rule' NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "asset_id" uuid REFERENCES "bms"."assets"("id"),
  "point_key" varchar(128),
  "operator" varchar(16),
  "threshold_value" double precision,
  "severity" varchar(32),
  "condition" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "action" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_evaluated_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "automation_rules_code_idx"
ON "bms"."automation_rules" ("code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_rules_enabled_idx"
ON "bms"."automation_rules" ("enabled", "rule_type", "category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_rules_asset_point_idx"
ON "bms"."automation_rules" ("asset_id", "point_key")
WHERE "asset_id" IS NOT NULL AND "point_key" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bms"."rule_executions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "rule_id" uuid NOT NULL REFERENCES "bms"."automation_rules"("id"),
  "evaluated_at" timestamptz DEFAULT now() NOT NULL,
  "status" varchar(32) NOT NULL,
  "matched" boolean DEFAULT false NOT NULL,
  "observed_value" double precision,
  "message" text,
  "trace" jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rule_executions_rule_time_idx"
ON "bms"."rule_executions" ("rule_id", "evaluated_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rule_executions_time_idx"
ON "bms"."rule_executions" ("evaluated_at" DESC);
