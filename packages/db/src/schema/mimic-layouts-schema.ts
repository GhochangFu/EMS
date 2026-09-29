import {
  boolean,
  foreignKey,
  index,
  integer,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { assetRoles, bmsSchema, organizations, users } from "./bms-schema";

/**
 * `F3.32e` / ADR 0084 decision 1 — the preloaded symbol libraries, migration `0090`. Global
 * lookup tables in the `bms.asset_roles` shape: no organization, no row security. The style and
 * group CHECKs and the key-names-its-library CHECK are the migration's, not mirrored here.
 */
export const mimicSymbolLibraries = bmsSchema.table("mimic_symbol_libraries", {
  code: varchar("code", { length: 32 }).primaryKey(),
  label: varchar("label", { length: 64 }).notNull(),
  source: varchar("source", { length: 120 }).notNull(),
  version: varchar("version", { length: 32 }).notNull(),
  licence: varchar("licence", { length: 64 }).notNull(),
  attributionUrl: varchar("attribution_url", { length: 255 }).notNull(),
  style: varchar("style", { length: 8 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(100),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One symbol a unit can draw: a bare core key, or `<library>:<name>` (ADR 0084 decision 2). */
export const mimicSymbols = bmsSchema.table(
  "mimic_symbols",
  {
    key: varchar("key", { length: 64 }).primaryKey(),
    libraryCode: varchar("library_code", { length: 32 })
      .notNull()
      .references(() => mimicSymbolLibraries.code),
    label: varchar("label", { length: 64 }).notNull(),
    groupCode: varchar("group_code", { length: 16 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(100),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    libraryIdx: index("mimic_symbols_library_idx").on(t.libraryCode, t.groupCode, t.sortOrder),
  }),
);

/**
 * The mimic layout library — `F3.32c`, migration `0088`, ADR 0081 decision 1.
 *
 * Own file, the `site-control-room-views-schema.ts` precedent: the tables live
 * in the `bms` Postgres schema, and `bmsSchema` is imported, not redeclared.
 *
 * **`CHECK` constraints are deliberately not mirrored here**, the
 * `report-files-schema.ts` convention: the migration owns the canvas, version,
 * kind, symbol, tone, per-kind field, box, pipe-end and not-self CHECKs, and
 * `tests/f3.32c-mimic-layouts-schema.test.ts` pins each by name and compares
 * the symbol list and the grid literals with `packages/shared`.
 *
 * All three tables are tenant tables under `FORCE ROW LEVEL SECURITY`: a write
 * runs in `withTenant`, a read on the fleet pool filters by organization itself.
 */
export const mimicLayouts = bmsSchema.table(
  "mimic_layouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: varchar("name", { length: 120 }).notNull(),
    slug: varchar("slug", { length: 64 }).notNull(),
    canvasW: integer("canvas_w").notNull(),
    canvasH: integer("canvas_h").notNull(),
    // Optimistic concurrency (ADR 0081 decision 2): a save names the version it
    // loaded, and the update increments it.
    version: integer("version").notNull().default(1),
    // `F3.32e` / ADR 0084 decision 8 — the libraries the layout draws from (migration `0090`).
    // At least one member is `mimic_layouts_symbol_libraries_check`'s, not mirrored here.
    symbolLibraries: varchar("symbol_libraries", { length: 32 }).array().notNull().default(["core"]),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    organizationSlugUnique: unique("mimic_layouts_organization_slug_key").on(
      t.organizationId,
      t.slug,
    ),
  }),
);

/**
 * A unit, a panel or a label of one layout. `key` is how pipes and the
 * resolver name it; the id regenerates on every save (plan D5). `roleCode` is
 * null on a panel, a label, or a passive unit (plan D6).
 */
export const mimicLayoutNodes = bmsSchema.table(
  "mimic_layout_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    layoutId: uuid("layout_id")
      .notNull()
      .references(() => mimicLayouts.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 32 }).notNull(),
    kind: varchar("kind", { length: 16 }).notNull(),
    // `F3.32e` / ADR 0084 decision 3 — a foreign key to `mimic_symbols` replaced 0089's CHECK.
    symbol: varchar("symbol", { length: 64 }).references(() => mimicSymbols.key),
    label: varchar("label", { length: 64 }).notNull(),
    roleCode: varchar("role_code", { length: 64 }).references(() => assetRoles.code),
    tone: varchar("tone", { length: 16 }),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    w: integer("w").notNull(),
    h: integer("h").notNull(),
    z: integer("z").notNull().default(0),
  },
  (t) => ({
    layoutKeyUnique: unique("mimic_layout_nodes_layout_key_key").on(t.layoutId, t.key),
    // The target of the pipes' three-column foreign keys (plan D7).
    layoutIdKindUnique: unique("mimic_layout_nodes_layout_id_kind_key").on(
      t.layoutId,
      t.id,
      t.kind,
    ),
    layoutIdx: index("mimic_layout_nodes_layout_idx").on(t.layoutId, t.z, t.y, t.x),
  }),
);

/**
 * A pipe between two units of the same layout. `fromKind`/`toKind` exist only
 * to carry the three-column foreign keys to `(layout_id, id, kind)`; the
 * migration's `_ends_are_units_check` pins both to `'unit'` (plan D7).
 */
export const mimicLayoutPipes = bmsSchema.table(
  "mimic_layout_pipes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    layoutId: uuid("layout_id")
      .notNull()
      .references(() => mimicLayouts.id, { onDelete: "cascade" }),
    fromNodeId: uuid("from_node_id").notNull(),
    toNodeId: uuid("to_node_id").notNull(),
    fromKind: varchar("from_kind", { length: 16 }).notNull().default("unit"),
    toKind: varchar("to_kind", { length: 16 }).notNull().default("unit"),
  },
  (t) => ({
    fromFk: foreignKey({
      name: "mimic_layout_pipes_from_fkey",
      columns: [t.layoutId, t.fromNodeId, t.fromKind],
      foreignColumns: [mimicLayoutNodes.layoutId, mimicLayoutNodes.id, mimicLayoutNodes.kind],
    }).onDelete("cascade"),
    toFk: foreignKey({
      name: "mimic_layout_pipes_to_fkey",
      columns: [t.layoutId, t.toNodeId, t.toKind],
      foreignColumns: [mimicLayoutNodes.layoutId, mimicLayoutNodes.id, mimicLayoutNodes.kind],
    }).onDelete("cascade"),
    layoutEndsUnique: unique("mimic_layout_pipes_layout_ends_key").on(
      t.layoutId,
      t.fromNodeId,
      t.toNodeId,
    ),
    toIdx: index("mimic_layout_pipes_to_idx").on(t.layoutId, t.toNodeId),
  }),
);
