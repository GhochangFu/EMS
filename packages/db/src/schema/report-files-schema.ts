import { char, date, integer, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { bmsSchema, organizations, users } from "./bms-schema";

/**
 * `bms.report_files` — `F3.5a`, migration `0077`, ADR 0071 decision 4.
 *
 * Own file rather than a block in `bms-schema.ts`, following the
 * `asset-images-schema.ts` precedent: the table still lives in the `bms`
 * Postgres schema — `bmsSchema` is imported, not redeclared.
 *
 * This row pairs a fixed object key in the S3-compatible bucket
 * (`org/<organizationId>/reports/<fileId>`, built once by
 * `apps/api/src/storage/object-key.ts`'s `buildReportObjectKey`, ADR 0071
 * decision 5) with the tenant metadata the file routes need. The bytes
 * themselves are never in this table.
 *
 * **`CHECK` constraints are deliberately not mirrored here**, following the
 * `asset-images-schema.ts` convention: the migration owns them, and
 * `tests/f3.5a-report-files-schema.test.ts` pins each by name. `UNIQUE`
 * constraints *are* mirrored and *are* named, because drizzle otherwise
 * derives a name and then `\d` and this file describe one object under two
 * names.
 *
 * **`scheduleId` is deliberately absent** (ADR 0071 decision 4/9, F3.5a plan
 * R-8): the column, its FK to `bms.report_schedules` and the
 * `(schedule_id, period_end, format)` unique index all arrive with migration
 * `0078` in `F3.5b`. Adding it here, nullable and unused, would be a column
 * this table cannot yet reference and a seam this unit does not own.
 */
export const reportFiles = bmsSchema.table(
  "report_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // ADR 0043/0045: tenant-scoped in the creating migration, never
    // retrofitted.
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    templateId: text("template_id").notNull(),
    format: text("format").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    // `{}` = whole organization; the readers' scope snapshot at write time
    // (ADR 0071 decision 4). Not a foreign key — checked in the service.
    locationIds: uuid("location_ids").array().notNull().default([]),
    // Deliberately absent from `reportFileDtoSchema` (ADR 0071 decision 4) —
    // no client-facing route echoes this value.
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    filename: text("filename").notNull(),
    deliveryStatus: text("delivery_status").notNull().default("none"),
    deliveryError: text("delivery_error"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    objectKeyUnique: unique("report_files_object_key_key").on(t.objectKey),
  }),
);
