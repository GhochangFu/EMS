import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { assetDomains, assets, bmsSchema, organizations, users } from "./bms-schema";
import { alarmSkills, alarms } from "./alarms-schema";

/**
 * Work orders and planned maintenance — the operator's response to an alarm,
 * and the schedule that raises work before one is raised.
 *
 * References point at `bms-schema.ts` and at `alarms-schema.ts`
 * (`work_orders.alarm_id`), never back into this module from either. No
 * Drizzle table references a work order or a maintenance row, which is what
 * makes this the clean half of the split; `bms.maintenance_windows` (0152)
 * links both, but by SQL-only keys, so the import direction holds.
 *
 * Split out of `bms-schema.ts`, which stood at 999 of AGENTS.md §4.5's
 * 1000-line cap. No table, column, constraint or comment changed in the move.
 */

/**
 * E3.1 (ADR 0122 decision 5.1, migration 0148) — the coded causes a work order's root
 * cause may carry. Platform vocabulary in the ADR 0031 / 0034 shape: data, not an enum;
 * retired with `active = false`, never deleted. No tenant column and no row security;
 * `bms_tenant` may only read it. Declared above `workOrders`, which references it.
 */
export const workOrderCauseCodes = bmsSchema.table("work_order_cause_codes", {
  code: varchar("code", { length: 64 }).primaryKey(),
  label: varchar("label", { length: 128 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(100),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workOrders = bmsSchema.table("work_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  // E7.1b (ADR 0043 §5): NOT NULL — migration 0047 applied the SET NOT NULL.
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  // E3.1 (ADR 0122 decision 2, migration 0140): the per-organization number and the
  // `<PREFIX>-<seq>` reference built from it. Both come from
  // `allocateWorkOrderReference`, are written once at create and never change.
  // UNIQUE (organization_id, seq) and UNIQUE (organization_id, reference).
  seq: integer("seq").notNull(),
  reference: varchar("reference", { length: 32 }).notNull(),
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
  // E3.1 (ADR 0122 decision 3, migration 0140): the SLA snapshot. Minutes from creation
  // to `resolved`, copied at create from the organization's policy (or the platform
  // default, or the create body); `slaDueAt` is `createdAt + slaMinutes`. Both NULL on a
  // ticket older than 0140 — a CHECK keeps them NULL together.
  slaMinutes: integer("sla_minutes"),
  slaDueAt: timestamp("sla_due_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  // E3.1 (ADR 0122 decision 5, migration 0148): the technician's own findings. Editable
  // while `resolved`, frozen at `closed`. Required to resolve a ticket raised from an alarm.
  rootCause: text("root_cause"),
  correctiveAction: text("corrective_action"),
  preventiveAction: text("preventive_action"),
  causeCode: varchar("cause_code", { length: 64 }).references(() => workOrderCauseCodes.code),
  // E3.4 (ADR 0122 decision 5a, migration 0148): the alarm's enrichment as it stood when
  // the ticket was created. Written ONCE, by `insertWorkOrder`, and never updated: a
  // later edit of the enrichment does not reach the ticket.
  // `tests/e3.1-alarm-snapshot-single-writer.test.ts` holds the single writer.
  alarmRootCause: text("alarm_root_cause"),
  alarmCorrectiveActions: text("alarm_corrective_actions"),
  alarmSkillCode: varchar("alarm_skill_code", { length: 64 }).references(() => alarmSkills.code),
  alarmEtrAt: timestamp("alarm_etr_at", { withTimezone: true }),
  // E3.1 (ADR 0122 decision 6, migration 0148): who resolved it; cleared when the ticket
  // goes back to work. The approval and cancel stamps have no writer until the next PR.
  resolvedBy: uuid("resolved_by").references(() => users.id),
  approvedBy: uuid("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  cancelledBy: uuid("cancelled_by").references(() => users.id),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * E3.1 (ADR 0122 decision 2.3, migration 0140) — one row per organization: the next
 * `work_orders.seq` to hand out. Written only by `allocateWorkOrderReference`, whose
 * upsert takes the row lock, so two concurrent creates never read the same number.
 * Tenant table under FORCE row security.
 */
export const workOrderCounters = bmsSchema.table("work_order_counters", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id),
  nextSeq: integer("next_seq").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * E3.1 (ADR 0122 decision 3.2, migration 0140) — an organization's SLA per priority, in
 * minutes from creation to `resolved`. A priority with no row uses
 * `WORK_ORDER_SLA_DEFAULT_MINUTES`. Create snapshots the value onto the ticket, so an
 * edit here never moves an open ticket. Tenant table under FORCE row security.
 */
export const workOrderSlaPolicies = bmsSchema.table(
  "work_order_sla_policies",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    priority: varchar("priority", { length: 32 }).notNull(),
    resolutionMinutes: integer("resolution_minutes").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.priority] })],
);

/**
 * E3.1 (ADR 0122 decision 7, migration 0144) — a work order's timeline: one row per
 * thing that happened to it, written in the same transaction as the change.
 *
 * Append-only by privilege: `UPDATE` and `DELETE` are revoked from `bms_tenant` and
 * `bms_fleet`, so only `insert` and `select` work from the API. `actorName` is the
 * actor's display name SAVED at write time (ruling P7), never an email or a subject;
 * `detail` is the closed shape `workOrderEventDetailSchema` (`@bms/shared`).
 * `eventType` is a `CHECK` over `WORK_ORDER_EVENT_TYPES`. Tenant table under FORCE row
 * security, with a policy that also checks the parent work order's organization — and
 * a composite foreign key `(organization_id, work_order_id)` to
 * `work_orders(organization_id, id)` that says the same for a role the policy does not
 * bind (`bms_fleet`). The key lives in the migration; Drizzle declares the simple one.
 */
export const workOrderEvents = bmsSchema.table("work_order_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  workOrderId: uuid("work_order_id")
    .notNull()
    .references(() => workOrders.id),
  eventType: varchar("event_type", { length: 32 }).notNull(),
  actorId: uuid("actor_id").references(() => users.id),
  actorName: varchar("actor_name", { length: 255 }),
  fromStatus: varchar("from_status", { length: 32 }),
  toStatus: varchar("to_status", { length: 32 }),
  detail: jsonb("detail").notNull().default({}),
  // `clock_timestamp()`, not `now()`: two events of one transaction must not share a
  // timestamp, or the timeline orders them by their random ids (migration 0144).
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`clock_timestamp()`),
});

/**
 * E3.1 (ADR 0122 decision 4.2, migration 0145) — a reusable checklist: per organization
 * and optionally per asset domain (`domain` NULL fits every domain). Its name is unique
 * in the organization, case-insensitively. Retired with `active = false`, never
 * deleted. Tenant table under FORCE row security.
 */
export const workOrderChecklistTemplates = bmsSchema.table("work_order_checklist_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  name: varchar("name", { length: 255 }).notNull(),
  domain: varchar("domain", { length: 64 }).references(() => assetDomains.code),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id),
  updatedBy: uuid("updated_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * E3.1 (ADR 0122 decision 4.2, migration 0145) — one line of a checklist template. It
 * carries its own `organizationId` (plan D7); the policy also checks the template's,
 * and a composite foreign key `(organization_id, template_id)` says the same for a role
 * the policy does not bind. The key lives in the migration; Drizzle declares the simple
 * one. A template edit REPLACES its items, so an item id is not stable.
 */
export const workOrderChecklistTemplateItems = bmsSchema.table("work_order_checklist_template_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  templateId: uuid("template_id")
    .notNull()
    .references(() => workOrderChecklistTemplates.id),
  title: varchar("title", { length: 255 }).notNull(),
  mandatory: boolean("mandatory").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * A ticket's checklist (E3.1, ADR 0122 decision 4.1). One row per item, copied from a
 * template at create as a frozen snapshot, or added by hand.
 *
 * `result` is a `CHECK` over `WORK_ORDER_TASK_RESULTS`; a `mandatory` item that is
 * still `pending` blocks the move to `resolved`. `status` is the legacy column: it
 * stays and is no longer read (plan D21). Since migration 0145 the policy also checks
 * the parent work order's organization (ruling P9), and a composite foreign key
 * `(organization_id, work_order_id)` says the same for `bms_fleet`.
 */
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
  mandatory: boolean("mandatory").notNull().default(false),
  result: varchar("result", { length: 16 }).notNull().default("pending"),
  note: text("note"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedBy: uuid("completed_by").references(() => users.id),
  // ON DELETE SET NULL (migration 0145): a template edit replaces its items, and the
  // copied task must survive it. In the database the key is composite,
  // `(organization_id, template_item_id)`, and clears this column only.
  templateItemId: uuid("template_item_id").references(() => workOrderChecklistTemplateItems.id, {
    onDelete: "set null",
  }),
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
    // E3.1 (ADR 0122 decision 4.3, migration 0145): the checklist a converted schedule's
    // work order starts with. NULL is none. The migration's composite foreign key keeps
    // it inside the schedule's own organization.
    checklistTemplateId: uuid("checklist_template_id").references(() => workOrderChecklistTemplates.id),
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

