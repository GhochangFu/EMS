import { integer, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { assetPoints, bmsSchema, organizations, users } from "./bms-schema";

/**
 * `bms.calc_backfill_runs` — `F4.311`, migration `0123`, ADR 0109 decision 7. One
 * row per calculated-point backfill run (`queued` → `running` → `done` | `failed`).
 *
 * Own file, the `trend-points-schema.ts` precedent. The partial unique index
 * `calc_backfill_runs_one_active` (one queued/running run per point) and the
 * `CHECK`s (status vocabulary, 31-day window, `written_rows >= 0`) live in the
 * migration and are not mirrored, the `report-files-schema.ts` convention.
 * `assetPointId` cascades on delete; `organizationId` and `requestedBy` carry no
 * `ON DELETE` clause.
 */
export const calcBackfillRuns = bmsSchema.table("calc_backfill_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  // ADR 0043/0045: tenant-scoped in the creating migration, never retrofitted.
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  assetPointId: uuid("asset_point_id")
    .notNull()
    .references(() => assetPoints.id, { onDelete: "cascade" }),
  fromAt: timestamp("from_at", { withTimezone: true }).notNull(),
  toAt: timestamp("to_at", { withTimezone: true }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("queued"),
  doneThrough: timestamp("done_through", { withTimezone: true }),
  writtenRows: integer("written_rows").notNull().default(0),
  error: text("error"),
  requestedBy: uuid("requested_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
