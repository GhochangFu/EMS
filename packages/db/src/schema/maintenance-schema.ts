import {
  boolean,
  integer,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { assets, bmsSchema, organizations, users } from "./bms-schema";
import { alarms } from "./alarms-schema";

/**
 * Work orders and planned maintenance — the operator's response to an alarm,
 * and the schedule that raises work before one is raised.
 *
 * References point at `bms-schema.ts` and at `alarms-schema.ts`
 * (`work_orders.alarm_id`), never back into this module from either. Nothing
 * in the platform references a work order or a maintenance row, which is what
 * makes this the clean half of the split.
 *
 * Split out of `bms-schema.ts`, which stood at 999 of AGENTS.md §4.5's
 * 1000-line cap. No table, column, constraint or comment changed in the move.
 */

export const workOrders = bmsSchema.table("work_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  // E7.1b (ADR 0043 §5): NOT NULL — migration 0047 applied the SET NOT NULL.
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
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
  // E7.1b: audit-added tenant table (decision 5 "at minimum"). NOT NULL as of
  // 0047; org resolves via work_order_id -> work_orders.
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
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
    // E7.1b: audit-added tenant table (decision 5 "at minimum"). NOT NULL as of
    // 0047; org resolves via asset_id -> assets.
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
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
  // E7.1b (ADR 0043 §5): NOT NULL as of 0047. No asset_id — org resolves via
  // template_id -> maintenance_task_templates.asset_id -> assets (see 0046).
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
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
  // E7.1b (ADR 0043 §5): NOT NULL — migration 0047 applied the SET NOT NULL.
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
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

