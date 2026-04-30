CREATE TABLE IF NOT EXISTS "bms"."maintenance_task_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asset_id" uuid NOT NULL REFERENCES "bms"."assets"("id"),
  "title" varchar(255) NOT NULL,
  "description" text,
  "priority" varchar(32) DEFAULT 'medium' NOT NULL,
  "estimated_minutes" integer DEFAULT 60 NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bms"."maintenance_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "template_id" uuid NOT NULL REFERENCES "bms"."maintenance_task_templates"("id"),
  "interval_days" integer NOT NULL,
  "next_due_at" timestamp with time zone NOT NULL,
  "last_completed_at" timestamp with time zone,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "maintenance_schedules_interval_days_positive"
    CHECK ("interval_days" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bms"."maintenance_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "template_id" uuid NOT NULL REFERENCES "bms"."maintenance_task_templates"("id"),
  "schedule_id" uuid NOT NULL REFERENCES "bms"."maintenance_schedules"("id"),
  "asset_id" uuid NOT NULL REFERENCES "bms"."assets"("id"),
  "work_order_id" uuid REFERENCES "bms"."work_orders"("id"),
  "event_type" varchar(32) NOT NULL,
  "notes" text,
  "created_by" uuid REFERENCES "bms"."users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maintenance_task_templates_asset_idx"
ON "bms"."maintenance_task_templates" ("asset_id", "active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maintenance_schedules_due_idx"
ON "bms"."maintenance_schedules" ("active", "next_due_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maintenance_history_asset_created_idx"
ON "bms"."maintenance_history" ("asset_id", "created_at" DESC);
