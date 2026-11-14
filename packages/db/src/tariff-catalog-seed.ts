import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { type TariffCatalogSnapshot, tariffCatalogSnapshotSchema } from "@bms/shared";

/**
 * `F4.365` (ADR 0134 decisions 1–2, plan D1–D4) — the global tariff catalog
 * as committed data.
 *
 * `tariff-catalog.json` is generated from the owner's workbook by
 * `pnpm --filter api tariffs:import <file> --out …`; a catalog change is a
 * reviewed JSON diff. `pnpm db:seed` upserts it as `bms_owner` on every run;
 * `tariffs:import --apply` runs the same function as `bms_fleet`.
 *
 * Upsert by `(key, effective_from)`: insert or update the category, replace
 * its slabs, never delete a category (a mapping may still point at its line).
 * Each statement compares before it writes, so an unchanged snapshot writes
 * nothing and `updated_at` stays put.
 */

const CATALOG_CANDIDATES = ["src/tariff-catalog.json", "packages/db/src/tariff-catalog.json"];

export interface TariffCatalogQueryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

export function loadTariffCatalog(): TariffCatalogSnapshot {
  const path = CATALOG_CANDIDATES.map((c) => resolve(process.cwd(), c)).find((p) => existsSync(p));
  if (path === undefined) {
    throw new Error(`tariff-catalog.json not found from ${process.cwd()}; tried ${CATALOG_CANDIDATES.join(", ")}`);
  }
  return tariffCatalogSnapshotSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

const UPSERT_CATEGORY = `
INSERT INTO bms.tariff_categories
  (key, area_id, state, discoms, ownership, code, name, segment, supply, energy_unit, fixed_basis,
   data_status, tariff_order, effective_from, source_url, notes)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
ON CONFLICT (key, effective_from) DO UPDATE SET
  area_id = EXCLUDED.area_id, state = EXCLUDED.state, discoms = EXCLUDED.discoms,
  ownership = EXCLUDED.ownership, code = EXCLUDED.code, name = EXCLUDED.name,
  segment = EXCLUDED.segment, supply = EXCLUDED.supply, energy_unit = EXCLUDED.energy_unit,
  fixed_basis = EXCLUDED.fixed_basis, data_status = EXCLUDED.data_status,
  tariff_order = EXCLUDED.tariff_order, source_url = EXCLUDED.source_url, notes = EXCLUDED.notes,
  updated_at = now()
WHERE (tariff_categories.area_id, tariff_categories.state, tariff_categories.discoms,
       tariff_categories.ownership, tariff_categories.code, tariff_categories.name,
       tariff_categories.segment, tariff_categories.supply, tariff_categories.energy_unit,
       tariff_categories.fixed_basis, tariff_categories.data_status, tariff_categories.tariff_order,
       tariff_categories.source_url, tariff_categories.notes)
  IS DISTINCT FROM
      (EXCLUDED.area_id, EXCLUDED.state, EXCLUDED.discoms, EXCLUDED.ownership, EXCLUDED.code,
       EXCLUDED.name, EXCLUDED.segment, EXCLUDED.supply, EXCLUDED.energy_unit, EXCLUDED.fixed_basis,
       EXCLUDED.data_status, EXCLUDED.tariff_order, EXCLUDED.source_url, EXCLUDED.notes)
RETURNING id`;

const UPSERT_SLAB = `
INSERT INTO bms.tariff_slabs (category_id, slab_no, from_units, to_units, energy_rate, fixed_rate, wheeling_rate, notes)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (category_id, slab_no) DO UPDATE SET
  from_units = EXCLUDED.from_units, to_units = EXCLUDED.to_units, energy_rate = EXCLUDED.energy_rate,
  fixed_rate = EXCLUDED.fixed_rate, wheeling_rate = EXCLUDED.wheeling_rate, notes = EXCLUDED.notes
WHERE (tariff_slabs.from_units, tariff_slabs.to_units, tariff_slabs.energy_rate,
       tariff_slabs.fixed_rate, tariff_slabs.wheeling_rate, tariff_slabs.notes)
  IS DISTINCT FROM
      (EXCLUDED.from_units, EXCLUDED.to_units, EXCLUDED.energy_rate,
       EXCLUDED.fixed_rate, EXCLUDED.wheeling_rate, EXCLUDED.notes)`;

/** Upserts every category and its slabs. Returns how many rows were actually written. */
export async function upsertTariffCatalog(
  db: TariffCatalogQueryable,
  snapshot: TariffCatalogSnapshot,
): Promise<{ categories: number; slabs: number }> {
  let categories = 0;
  let slabs = 0;
  for (const c of snapshot.categories) {
    const written = await db.query(UPSERT_CATEGORY, [
      c.key, c.areaId, c.state, c.discoms, c.ownership, c.code, c.name, c.segment, c.supply,
      c.energyUnit, c.fixedBasis, c.dataStatus, c.tariffOrder, c.effectiveFrom, c.sourceUrl, c.notes,
    ]);
    categories += written.rows.length;
    // An unchanged category returns no row from the upsert, so read its id.
    const id = (
      await db.query(`SELECT id FROM bms.tariff_categories WHERE key = $1 AND effective_from = $2`, [c.key, c.effectiveFrom])
    ).rows[0]?.id as string;
    const removed = await db.query(`DELETE FROM bms.tariff_slabs WHERE category_id = $1 AND slab_no > $2`, [id, c.slabs.length]);
    slabs += removed.rowCount ?? 0;
    for (const s of c.slabs) {
      const w = await db.query(UPSERT_SLAB, [id, s.slabNo, s.fromUnits, s.toUnits, s.energyRate, s.fixedRate, s.wheelingRate, s.notes]);
      slabs += w.rowCount ?? 0;
    }
  }
  return { categories, slabs };
}
