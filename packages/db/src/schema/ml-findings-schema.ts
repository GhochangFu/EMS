import { smallint, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";

import { bmsSchema, organizations } from "./bms-schema";

/**
 * `E1.9c` / ADR 0135 Amendment 8 decision 7, migration `0162` — the cache of the
 * AI-written findings paragraph. In `bms`, not `ml`: the API writes it, and
 * `bms_tenant` writes nowhere in `ml` (Amendment 3 ruling 2).
 *
 * One row per `(organization, kind, facts hash)`: `ok` with the paragraph in
 * placeholder form (no customer name), or `rejected` / `failed` with a fixed
 * reason and no text. `attempts` (owner ruling Q3 (a)) is the number of provider
 * calls this key has cost today; the daily cap sums it.
 *
 * A strict tenant table (FORCE RLS, `tenant_isolation`). `bms_tenant` holds
 * `SELECT`, `INSERT`, `DELETE` and no `UPDATE`; `bms_fleet` holds `SELECT` only.
 * The CHECKs (`kind`, `status`, the hash shape, "text iff ok", "reason iff not
 * ok", `attempts >= 1`) are the migration's, pinned by name in
 * `tests/e1.9c-ml-finding-paragraphs-schema.test.ts`; they are not mirrored here.
 */
export const mlFindingParagraphs = bmsSchema.table(
  "ml_finding_paragraphs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 16 }).notNull(),
    factsHash: varchar("facts_hash", { length: 64 }).notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    paragraph: text("paragraph"),
    reason: varchar("reason", { length: 32 }),
    provider: varchar("provider", { length: 32 }),
    model: varchar("model", { length: 200 }),
    attempts: smallint("attempts").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("ml_finding_paragraphs_org_kind_hash_key").on(t.organizationId, t.kind, t.factsHash)],
);
