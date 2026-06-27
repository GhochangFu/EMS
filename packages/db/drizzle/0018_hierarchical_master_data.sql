CREATE TABLE IF NOT EXISTS "bms"."user_organization_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bms"."user_organization_access" ADD CONSTRAINT "user_organization_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "bms"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bms"."user_organization_access" ADD CONSTRAINT "user_organization_access_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "bms"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_organization_access_user_org_unique" ON "bms"."user_organization_access" ("user_id","organization_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bms"."point_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" varchar(128) NOT NULL,
	"name" varchar(255) NOT NULL,
	"domain" varchar(64),
	"unit" varchar(32),
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bms"."point_keys" ADD CONSTRAINT "point_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "bms"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "point_keys_org_code_unique" ON "bms"."point_keys" ("organization_id","code");
