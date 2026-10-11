import {
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { bmsSchema, organizations, users } from "./bms-schema";

/**
 * The administrator copilot's availability tables — `F3.85` PR 3, migration
 * `0104`, ADR 0099 decision 5.
 *
 * Own file, following `calc-parameters-schema.ts`: the copilot adds more tables
 * in later PRs (pending changes, history, usage) and they belong together. The
 * tables live in the `bms` Postgres schema — `bmsSchema` is imported, not
 * redeclared.
 *
 * All three are tenant tables: FORCE RLS with the strict `tenant_isolation`
 * policy. The role CHECK (`copilot_role_settings_role_check`) is not mirrored
 * here; the migration owns it and `tests/f3.85-copilot-access-schema.test.ts`
 * pins it by name.
 *
 * `bms_fleet` keeps 0041's default DML on all three (the 0100 model). The
 * migration's header gives a "fleet read" by the Organizations page as the reason;
 * no such read exists — every read and write in `F3.85` PR 3 goes through
 * `withTenant` on `bms_tenant`. The header cannot be edited (frozen migrations),
 * so the correction lives here.
 *
 * `F3.85` PR 4, migration `0105` (ADR 0099 decisions 4 and 8), adds the three
 * per-user tables below. They are not tenant tables: each has FORCE RLS with a
 * strict `user_isolation` policy on `app.current_user` (set by `withUser`),
 * and `bms_fleet` holds no privilege on them. Not mirrored here, and pinned by
 * name in `tests/f3.85-copilot-history-schema.test.ts`: the three CHECKs
 * (`copilot_messages_role_check`, `copilot_pending_changes_risk_check`,
 * `copilot_pending_changes_status_check`) and the two composite foreign keys
 * that tie a message or a pending change to a conversation **of the same
 * user** (`(conversation_id, user_id)` → `(id, user_id)`). Drizzle cannot
 * write the pending change's `ON DELETE SET NULL (conversation_id)`, so the
 * migration owns both keys and `conversationId` below declares no reference.
 */

/** One organization's switch. No row means off (ruling 15). */
export const copilotOrgSettings = bmsSchema.table("copilot_org_settings", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** The switch for `location_admin` or `asset_group_admin` in one organization. No row means on (plan Q2). */
export const copilotRoleSettings = bmsSchema.table(
  "copilot_role_settings",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 64 }).notNull(),
    enabled: boolean("enabled").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.role] })],
);

/** A named-user exception in one organization, in either direction (plan Q2). */
export const copilotUserOverrides = bmsSchema.table(
  "copilot_user_overrides",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    allow: boolean("allow").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.userId] })],
);

/** One copilot conversation of one user. `organizationId` null is the global admin's cross-organization view (decision 10). */
export const copilotConversations = bmsSchema.table(
  "copilot_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastTurnAt: timestamp("last_turn_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("copilot_conversations_user_last_turn_idx").on(t.userId, t.lastTurnAt),
    unique("copilot_conversations_id_user_key").on(t.id, t.userId),
  ],
);

/** One turn of a conversation. `organizationIds`: the organizations an assistant or action message's tools read. */
export const copilotMessages = bmsSchema.table(
  "copilot_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 16 }).notNull(),
    content: text("content").notNull(),
    organizationIds: uuid("organization_ids").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("copilot_messages_conversation_created_idx").on(t.conversationId, t.createdAt)],
);

/**
 * A change the model proposed and the user has not yet confirmed (decision 4).
 * The `X-Copilot-Change` interceptor claims it `pending` -> `applying` in one
 * statement, then records `applied` or `failed`.
 */
export const copilotPendingChanges = bmsSchema.table(
  "copilot_pending_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id"),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    catalogId: varchar("catalog_id", { length: 64 }).notNull(),
    method: varchar("method", { length: 8 }).notNull(),
    path: varchar("path", { length: 512 }).notNull(),
    body: jsonb("body").notNull(),
    bodyHash: char("body_hash", { length: 64 }).notNull(),
    summary: text("summary").notNull(),
    risk: varchar("risk", { length: 16 }).notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    proposedAt: timestamp("proposed_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    resultStatus: integer("result_status"),
    resourceId: varchar("resource_id", { length: 128 }),
  },
  (t) => [
    index("copilot_pending_changes_user_status_idx").on(t.userId, t.status),
    index("copilot_pending_changes_conversation_idx").on(t.conversationId),
  ],
);

/**
 * One user's copilot turns on one day (`F3.85` PR 6, migration `0106`, ADR 0099
 * decision 11). `day` is the date in the user's home organization's timezone
 * (A2); the global admin's is the UTC date. `user_isolation` policy.
 */
export const copilotUsage = bmsSchema.table(
  "copilot_usage",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    turns: integer("turns").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

/** One organization's copilot turns on one day, `day` in that organization's timezone (A2). `tenant_isolation` policy. */
export const copilotOrgUsage = bmsSchema.table(
  "copilot_org_usage",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    turns: integer("turns").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.day] })],
);
