import { boolean, text, time, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { bmsSchema, organizations, users } from "./bms-schema";
import { notificationChannels } from "./alarms-schema";

/**
 * `bms.report_schedules` — `F3.5b`, migration `0078`, ADR 0071 decision 7.
 *
 * Own file, the `report-files-schema.ts` / `asset-images-schema.ts`
 * precedent: the table lives in the `bms` Postgres schema — `bmsSchema` is
 * imported, not redeclared.
 *
 * **`CHECK` constraints are deliberately not mirrored here**, the
 * `report-files-schema.ts` convention: the migration owns them, and
 * `tests/f3.5b-report-schedules-schema.test.ts` pins each by name.
 *
 * **No partial unique index is declared here either.** Drizzle 0.38.4's
 * `uniqueIndex(...).on(...).where(...)` has no precedent anywhere in this
 * package (`packages/db/src/schema` has no partial index today), so this
 * file does not introduce the first one. The migration owns
 * `report_files_schedule_period_format_key` and
 * `report_files_schedule_created_idx`, and the schema test pins their exact
 * text — the same division of labour the CHECK constraints already use.
 *
 * `runAtLocal` is `time(0)` at the database (seconds forced to `:00` by
 * `report_schedules_run_at_minute_check`) and is read back by the service as
 * `HH:MM:SS`; `reportScheduleDtoSchema.runAtLocal` carries the sliced
 * `HH:MM` (F3.5b plan R-16).
 */
export const reportSchedules = bmsSchema.table("report_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  // ADR 0043/0045: tenant-scoped in the creating migration, never
  // retrofitted.
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  templateId: text("template_id").notNull(),
  formats: text("formats").array().notNull(),
  cadence: text("cadence").notNull(),
  runAtLocal: time("run_at_local", { precision: 0 }).notNull(),
  timezone: varchar("timezone", { length: 64 }).notNull(),
  // `{}` = whole organization; resolved to asset ids under RLS at render
  // time (ADR 0071 decision 7). Not a foreign key.
  locationIds: uuid("location_ids").array().notNull().default([]),
  channelId: uuid("channel_id").references(() => notificationChannels.id, { onDelete: "set null" }),
  enabled: boolean("enabled").notNull().default(true),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
