import { char, integer, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { assets, bmsSchema, organizations, users } from "./bms-schema";

/**
 * `bms.asset_images` — `F3.3`, migration `0072`, ADR 0066 decision 5.
 *
 * Own file rather than a fourth block in `bms-schema.ts`, following the
 * `dashboard-schema.ts` precedent that opened this convention: `bms-schema.ts`
 * is already close to AGENTS.md §4.5's 1000-line cap, and the repository
 * already splits schema by area with `schema/index.ts` re-exporting each. The
 * table still lives in the `bms` Postgres schema — `bmsSchema` is imported,
 * not redeclared.
 *
 * This row pairs a fixed object key in the S3-compatible bucket
 * (`org/<organizationId>/assets/<assetId>/<imageId>`, built once by
 * `apps/api/src/storage/object-key.ts`, ADR 0066 decision 4) with the tenant
 * metadata the two read routes need. The bytes themselves are never in this
 * table.
 *
 * **`CHECK` constraints are deliberately not mirrored here**, following the
 * convention `dashboard-schema.ts` and `automationRules.code` in
 * `bms-schema.ts` record: the migration owns them, and
 * `tests/f3.3-asset-images-schema.test.ts` pins each by name. That includes
 * `asset_images_content_type_check`, which closes the content-type vocabulary
 * to the three MIME types `assetImageContentTypeSchema` in
 * `@bms/shared/contracts/asset-images.ts` accepts — drift between the two
 * `CHECK` and `z.enum` declarations is the `F4.43` failure. `UNIQUE`
 * constraints *are* mirrored and *are* named, because drizzle otherwise
 * derives a name and then `\d` and this file describe one object under two
 * names — the trap `alarm_severities_rank_key` documents.
 */
export const assetImages = bmsSchema.table(
  "asset_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // ADR 0043/0045: tenant-scoped in the creating migration, never
    // retrofitted. E7.1b's 0046/0047 are the recorded cost of the other order.
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    // Deliberately absent from `assetImageDtoSchema` (ADR 0066 decision 4) —
    // no client-facing route echoes this value.
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    originalFilename: text("original_filename").notNull(),
    caption: text("caption"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    objectKeyUnique: unique("asset_images_object_key_key").on(t.objectKey),
  }),
);
