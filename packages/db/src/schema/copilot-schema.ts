import { boolean, primaryKey, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

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
