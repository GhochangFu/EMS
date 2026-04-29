import {
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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const assets = bmsSchema.table("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  siteName: varchar("site_name", { length: 255 }).notNull(),
  domain: varchar("domain", { length: 64 }).notNull().default("electrical"),
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
