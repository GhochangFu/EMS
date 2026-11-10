import { boolean, foreignKey, index, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";

import { bmsSchema, organizations, users } from "./bms-schema";
import { bytea } from "./column-types";

/**
 * `bms.service_account_tokens` — `F4.17`, migration `0144`, ADR 0125 decisions
 * 11, 13 and 17. One row per issued service-account token.
 *
 * `tokenId` is the 12-character public half of `bms_sat_<id>_<secret>`, the
 * verifier's lookup key; `tokenHash` is SHA-256 of the secret (32 bytes). The
 * token itself is never stored. Rows are never deleted (no pool role holds
 * `DELETE`): a revoked or expired token stays for the audit trail.
 *
 * The CHECKs (token-id alphabet, hash length, non-empty name, expiry within
 * 365 days of creation), the kind guard trigger and the three policies live in
 * the migration and are not mirrored, the `report-files-schema.ts` convention.
 * **No pool role can `SELECT token_hash` except `bms_auth`**: a tenant read of
 * this table must never name the column (it would fail with `42501`).
 */
export const serviceAccountTokens = bmsSchema.table(
  "service_account_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // ADR 0043/0045: tenant-scoped in the creating migration, never retrofitted.
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    // Held to a `kind = 'service'` user of the same organization (composite key + trigger).
    serviceAccountId: uuid("service_account_id").notNull(),
    tokenId: varchar("token_id", { length: 12 }).notNull(),
    tokenHash: bytea("token_hash").notNull(),
    name: varchar("name", { length: 64 }).notNull(),
    readOnly: boolean("read_only").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => {
    return {
      serviceAccountFk: foreignKey({
        name: "service_account_tokens_service_account_fkey",
        columns: [t.serviceAccountId, t.organizationId],
        foreignColumns: [users.id, users.organizationId],
      }),
      tokenIdKey: unique("service_account_tokens_token_id_key").on(t.tokenId),
      serviceAccountIdIdx: index("service_account_tokens_service_account_id_idx").on(t.serviceAccountId),
    };
  },
);
