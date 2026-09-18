import {
  boolean,
  doublePrecision,
  index,
  integer,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { assets, bmsSchema, locations, organizations } from "./bms-schema";

/**
 * Calc parameters — `E4.1a`, migration `0074`, ADR 0070 decision 2.
 *
 * Own file rather than two more tables in `bms-schema.ts`, following the
 * `dashboard-schema.ts` precedent that opened this convention: `bms-schema.ts`
 * stands at 646 lines and the repository already splits schema by area with
 * `schema/index.ts` re-exporting each. The tables still live in the `bms`
 * Postgres schema — `bmsSchema` is imported, not redeclared.
 *
 * **`CHECK` and `EXCLUDE` constraints are deliberately not mirrored here**,
 * following the convention `dashboard-schema.ts` records: the migration owns
 * them, and `tests/e4.1a-calc-parameters-schema.test.ts` pins each by name
 * (`calc_parameter_keys_code_charset_check`, `calc_parameters_scope_check`,
 * `calc_parameters_validity_check`, `calc_parameters_value_finite_check`,
 * `calc_parameters_no_overlap`). The `tenant_isolation` policy and `FORCE ROW
 * LEVEL SECURITY` on `calcParameters` likewise live in migration `0074`.
 */

/**
 * The calc parameter vocabulary — WHAT a `$key` means. GLOBAL: no
 * `organizationId`, no RLS and no policy, for the reason `0051` gives for
 * `assetRoles` (ADR 0049 decision 5 applied a third time): a stock template
 * that reads `$grid_carbon_factor_kgco2_per_kwh` must mean the same thing at
 * every site. The VALUE is per organization (`calcParameters`); only the name
 * is shared. Seeded with the twelve stock keys by migration `0074`, extended
 * by `INSERT`, never by a release. Retire a key with `active = false` — the
 * store's FK carries no `onDelete`, on purpose.
 */
export const calcParameterKeys = bmsSchema.table("calc_parameter_keys", {
  // `code` is the primary key: templates round-trip through JSON, which code
  // references survive and uuids do not. Charset `^[a-z][a-z0-9_]{0,63}$` is a
  // CHECK in migration 0074 (narrower than ADR 0065's catalog class — `$a-b`
  // must lex as `$a - b`); no `check()` here, per this file's convention.
  code: varchar("code", { length: 64 }).primaryKey(),
  label: varchar("label", { length: 128 }).notNull(),
  // Currency-neutral (`/kWh`, `/kL`); E4.1c adds organizations.currency for display.
  unit: varchar("unit", { length: 32 }),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(100),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The calc parameter store — WHAT the value IS for one organization, at one
 * scope, over one validity window. TENANT table: `organizationId NOT NULL`,
 * ENABLE + FORCE ROW LEVEL SECURITY and `tenant_isolation` in migration `0074`.
 *
 * Scope: at most one of `locationId` / `assetId` is set
 * (`calc_parameters_scope_check`); both NULL is the organization scope.
 * Resolution for `$key` on an asset at instant *t* takes the NEAREST scope —
 * asset, then the asset's location, then the organization — among rows whose
 * `[effectiveFrom, effectiveTo)` contains *t*. Two rows of the same key and
 * scope may not overlap in time (`calc_parameters_no_overlap`, a `btree_gist`
 * `EXCLUDE`, the race-proof backstop under the write path's 409 pre-read).
 *
 * Unset means NO value: a `$key` with no row in scope is a counted
 * `parameter_unset` refusal. There is no default anywhere.
 */
export const calcParameters = bmsSchema.table(
  "calc_parameters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    key: varchar("key", { length: 64 })
      .notNull()
      .references(() => calcParameterKeys.code),
    // Both scope parents CASCADE, for 0073's reason: a parameter about a gone
    // asset describes nothing. Migration 0074's tenant_isolation checks both
    // parents in USING and WITH CHECK — a foreign key runs with row security
    // OFF, so it never consults the parent's policy (0050's security review).
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }),
    // Finite by `calc_parameters_value_finite_check` (0031's form, migration 0074).
    value: doublePrecision("value").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    // NULL is open-ended; `calc_parameters_validity_check` holds `effectiveTo > effectiveFrom`.
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgKeyIdx: index("calc_parameters_org_key_idx").on(t.organizationId, t.key),
    locationIdx: index("calc_parameters_location_idx").on(t.locationId),
    assetIdx: index("calc_parameters_asset_idx").on(t.assetId),
  }),
);
