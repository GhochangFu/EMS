CREATE TABLE IF NOT EXISTS "bms"."work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"alarm_id" uuid,
	"title" varchar(255) NOT NULL,
	"description" text,
	"status" varchar(32) DEFAULT 'open' NOT NULL,
	"priority" varchar(32) DEFAULT 'medium' NOT NULL,
	"assigned_to" uuid,
	"created_by" uuid,
	"due_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_orders_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "bms"."assets"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "work_orders_alarm_id_alarms_id_fk" FOREIGN KEY ("alarm_id") REFERENCES "bms"."alarms"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "work_orders_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "bms"."users"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "work_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "bms"."users"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bms"."work_order_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"status" varchar(32) DEFAULT 'open' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_order_tasks_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "bms"."work_orders"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_orders_status_idx" ON "bms"."work_orders" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_orders_asset_id_idx" ON "bms"."work_orders" ("asset_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_orders_alarm_id_idx" ON "bms"."work_orders" ("alarm_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_orders_created_at_idx" ON "bms"."work_orders" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_order_tasks_work_order_id_idx" ON "bms"."work_order_tasks" ("work_order_id");
