import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const bmsSchema = pgSchema("bms");

export const users = bmsSchema.table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  role: varchar("role", { length: 64 }).notNull(),
  oidcSubject: varchar("oidc_subject", { length: 255 }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const locations = bmsSchema.table("locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  type: varchar("type", { length: 32 }).notNull(),
  province: varchar("province", { length: 64 }),
  capital: varchar("capital", { length: 128 }),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  active: boolean("active").notNull().default(true),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const assets = bmsSchema.table("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  siteName: varchar("site_name", { length: 255 }).notNull(),
  locationId: uuid("location_id").references(() => locations.id),
  domain: varchar("domain", { length: 64 }).notNull().default("electrical"),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const assetGroups = bmsSchema.table("asset_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  locationId: uuid("location_id")
    .notNull()
    .references(() => locations.id),
  code: varchar("code", { length: 64 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const assetGroupMembers = bmsSchema.table("asset_group_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetGroupId: uuid("asset_group_id")
    .notNull()
    .references(() => assetGroups.id),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userLocationAccess = bmsSchema.table("user_location_access", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  locationId: uuid("location_id")
    .notNull()
    .references(() => locations.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userAssetGroupAccess = bmsSchema.table("user_asset_group_access", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  assetGroupId: uuid("asset_group_id")
    .notNull()
    .references(() => assetGroups.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const alarms = bmsSchema.table("alarms", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id),
  ruleKey: varchar("rule_key", { length: 64 }),
  severity: varchar("severity", { length: 32 }).notNull(),
  message: text("message").notNull(),
  raisedAt: timestamp("raised_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  acknowledgedBy: uuid("acknowledged_by").references(() => users.id),
});

export const workOrders = bmsSchema.table("work_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id),
  alarmId: uuid("alarm_id").references(() => alarms.id),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 32 }).notNull().default("open"),
  priority: varchar("priority", { length: 32 }).notNull().default("medium"),
  sortOrder: integer("sort_order").notNull().default(0),
  assignedTo: uuid("assigned_to").references(() => users.id),
  createdBy: uuid("created_by").references(() => users.id),
  dueAt: timestamp("due_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const workOrderTasks = bmsSchema.table("work_order_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  workOrderId: uuid("work_order_id")
    .notNull()
    .references(() => workOrders.id),
  title: varchar("title", { length: 255 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("open"),
  sortOrder: integer("sort_order").notNull().default(0),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const maintenanceTaskTemplates = bmsSchema.table(
  "maintenance_task_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    category: varchar("category", { length: 64 }).notNull().default("preventive"),
    generationMode: varchar("generation_mode", { length: 32 })
      .notNull()
      .default("calendar"),
    ownerTeam: varchar("owner_team", { length: 128 }),
    vendorName: varchar("vendor_name", { length: 128 }),
    complianceRef: varchar("compliance_ref", { length: 128 }),
    triggerSummary: text("trigger_summary"),
    safetyCritical: boolean("safety_critical").notNull().default(false),
    priority: varchar("priority", { length: 32 }).notNull().default("medium"),
    estimatedMinutes: integer("estimated_minutes").notNull().default(60),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const maintenanceSchedules = bmsSchema.table("maintenance_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id")
    .notNull()
    .references(() => maintenanceTaskTemplates.id),
  intervalDays: integer("interval_days").notNull(),
  nextDueAt: timestamp("next_due_at", { withTimezone: true }).notNull(),
  lastCompletedAt: timestamp("last_completed_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const maintenanceHistory = bmsSchema.table("maintenance_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id")
    .notNull()
    .references(() => maintenanceTaskTemplates.id),
  scheduleId: uuid("schedule_id")
    .notNull()
    .references(() => maintenanceSchedules.id),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id),
  workOrderId: uuid("work_order_id").references(() => workOrders.id),
  eventType: varchar("event_type", { length: 32 }).notNull(),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const automationRules = bmsSchema.table("automation_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 64 }).notNull().default("operations"),
  ruleType: varchar("rule_type", { length: 32 }).notNull(),
  source: varchar("source", { length: 64 }).notNull().default("operator_rule"),
  enabled: boolean("enabled").notNull().default(true),
  assetId: uuid("asset_id").references(() => assets.id),
  pointKey: varchar("point_key", { length: 128 }),
  operator: varchar("operator", { length: 16 }),
  thresholdValue: doublePrecision("threshold_value"),
  severity: varchar("severity", { length: 32 }),
  condition: jsonb("condition").notNull().default({}),
  action: jsonb("action").notNull().default({}),
  lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
  lifecycleStatus: varchar("lifecycle_status", { length: 32 })
    .notNull()
    .default("published"),
  publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  duplicatedFromRuleId: uuid("duplicated_from_rule_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const ruleExecutions = bmsSchema.table("rule_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  ruleId: uuid("rule_id")
    .notNull()
    .references(() => automationRules.id),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  status: varchar("status", { length: 32 }).notNull(),
  matched: boolean("matched").notNull().default(false),
  observedValue: doublePrecision("observed_value"),
  message: text("message"),
  trace: jsonb("trace"),
});

export const auditLog = bmsSchema.table("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id").references(() => users.id),
  action: varchar("action", { length: 64 }).notNull(),
  entityType: varchar("entity_type", { length: 64 }).notNull(),
  entityId: uuid("entity_id"),
  reason: text("reason"),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Eskom stations + SMOC campuses for the world map (`ESKOM_STATIONS` shape + campuses). */
export const mapLocations = bmsSchema.table("map_locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  kind: varchar("kind", { length: 32 }).notNull(),
  siteName: varchar("site_name", { length: 255 }),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  capacityMw: integer("capacity_mw"),
  stationType: varchar("station_type", { length: 32 }),
  stationCategory: varchar("station_category", { length: 64 }),
  province: varchar("province", { length: 64 }),
  stationOperatingStatus: varchar("station_operating_status", { length: 16 }),
  meta: jsonb("meta"),
});
