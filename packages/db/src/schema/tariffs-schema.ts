import { date, numeric, primaryKey, smallint, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { assets, bmsSchema, locations, organizations, users } from "./bms-schema";

/**
 * Slab utility tariffs — `F4.365`, migrations `0154` and `0155`, ADR 0134.
 *
 * **`CHECK`, `EXCLUDE`, the composite slab FK, the REVOKE and the
 * `tenant_isolation` policies are not mirrored here** — the
 * `calc-parameters-schema.ts` convention: the migrations own them and
 * `tests/f4.365-tariff-schema.test.ts` pins each by name.
 *
 * `numeric` columns read as `string | null` (Drizzle's mapping); the services
 * convert at the boundary. `date` columns read as `YYYY-MM-DD` strings.
 */

const categoryColumns = () => ({
  id: uuid("id").primaryKey().defaultRandom(),
  key: varchar("key", { length: 200 }).notNull(),
  areaId: varchar("area_id", { length: 16 }).notNull(),
  state: varchar("state", { length: 100 }).notNull(),
  discoms: varchar("discoms", { length: 300 }).notNull(),
  ownership: varchar("ownership", { length: 100 }).notNull(),
  code: varchar("code", { length: 100 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  segment: varchar("segment", { length: 100 }).notNull(),
  supply: varchar("supply", { length: 100 }).notNull(),
  energyUnit: varchar("energy_unit", { length: 8 }).notNull(),
  fixedBasis: varchar("fixed_basis", { length: 32 }).notNull(),
  dataStatus: varchar("data_status", { length: 16 }).notNull(),
  tariffOrder: varchar("tariff_order", { length: 300 }),
  effectiveFrom: date("effective_from").notNull(),
  sourceUrl: varchar("source_url", { length: 500 }),
  notes: varchar("notes", { length: 1000 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

const slabColumns = () => ({
  slabNo: smallint("slab_no").notNull(),
  fromUnits: numeric("from_units", { precision: 14, scale: 3 }).notNull(),
  toUnits: numeric("to_units", { precision: 14, scale: 3 }),
  energyRate: numeric("energy_rate", { precision: 12, scale: 4 }).notNull(),
  fixedRate: numeric("fixed_rate", { precision: 12, scale: 4 }).notNull().default("0"),
  wheelingRate: numeric("wheeling_rate", { precision: 12, scale: 4 }).notNull().default("0"),
  notes: varchar("notes", { length: 500 }),
});

/** The GLOBAL catalog: one row per `(key, effective_from)` version. No RLS; `bms_tenant` reads only (`0154`). */
export const tariffCategories = bmsSchema.table("tariff_categories", categoryColumns());

export const tariffSlabs = bmsSchema.table(
  "tariff_slabs",
  {
    categoryId: uuid("category_id")
      .notNull()
      .references(() => tariffCategories.id, { onDelete: "cascade" }),
    ...slabColumns(),
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.slabNo] })],
);

/** An organization's revisions and custom lines (TENANT, FORCE RLS, `0155`). */
export const orgTariffCategories = bmsSchema.table("org_tariff_categories", {
  ...categoryColumns(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  reason: varchar("reason", { length: 500 }).notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
});

/** Slabs of an organization version; composite FK `(category_id, organization_id)` lives in `0155`. */
export const orgTariffSlabs = bmsSchema.table(
  "org_tariff_slabs",
  {
    categoryId: uuid("category_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    ...slabColumns(),
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.slabNo] })],
);

/** A location mapped to a tariff LINE (TENANT, FORCE RLS, both parent legs, `0155`). */
export const locationTariffs = bmsSchema.table("location_tariffs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  locationId: uuid("location_id")
    .notNull()
    .references(() => locations.id, { onDelete: "cascade" }),
  tariffKey: varchar("tariff_key", { length: 200 }).notNull(),
  billingMeterAssetId: uuid("billing_meter_asset_id")
    .notNull()
    .references(() => assets.id, { onDelete: "cascade" }),
  sanctionedLoad: numeric("sanctioned_load", { precision: 12, scale: 3 }).notNull(),
  sanctionedLoadUnit: varchar("sanctioned_load_unit", { length: 8 }).notNull(),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
