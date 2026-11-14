import type { Pool } from "pg";

import type { BillSlab, TariffDataStatus, TariffSource } from "@bms/shared";

type EnergyUnit = "kwh" | "kvah";
type FixedBasis = "per_kw_month" | "per_kva_month" | "per_hp_month" | "per_connection_month" | "per_connection_bimonth" | "none";

/**
 * `F4.365` (ADR 0134 decision 8) — the versions of a tariff line and the one
 * in force for a month.
 *
 * A line's versions come from the global catalog and from ONE organization's
 * own rows. The organization rows are always read joined on the pair's own
 * organization (`o.organization_id = p.organization_id`): the bill and cost
 * reads run on the fleet pool, which bypasses RLS (plan D12), so that equality
 * is the isolation.
 */
export interface TariffVersion {
  id: string;
  key: string;
  source: TariffSource;
  organizationId: string | null;
  name: string;
  state: string;
  energyUnit: EnergyUnit;
  fixedBasis: FixedBasis;
  dataStatus: TariffDataStatus;
  effectiveFrom: string;
  tariffOrder: string | null;
  sourceUrl: string | null;
  slabs: (BillSlab & { notes: string | null })[];
}

/** The latest version with `effectiveFrom <= firstDay`; on the same date the organization's wins. */
export function pickVersion(versions: readonly TariffVersion[], firstDay: string): TariffVersion | null {
  let best: TariffVersion | null = null;
  for (const v of versions) {
    if (v.effectiveFrom > firstDay) continue;
    if (
      best === null ||
      v.effectiveFrom > best.effectiveFrom ||
      (v.effectiveFrom === best.effectiveFrom && v.source === "organization" && best.source === "catalog")
    ) {
      best = v;
    }
  }
  return best;
}

export const pairKey = (organizationId: string, key: string): string => `${organizationId}\u0000${key}`;

interface VersionRow {
  pair_org: string;
  id: string;
  key: string;
  source: TariffSource;
  organization_id: string | null;
  name: string;
  state: string;
  energy_unit: EnergyUnit;
  fixed_basis: FixedBasis;
  data_status: TariffDataStatus;
  effective_from: string;
  tariff_order: string | null;
  source_url: string | null;
  slabs: { slab_no: number; from_units: string; to_units: string | null; energy_rate: string; fixed_rate: string; wheeling_rate: string; notes: string | null }[];
}

/**
 * Every version of each `(organizationId, key)` pair, catalog and that
 * organization's own, with slabs in order. One statement for any number of pairs.
 */
export async function readVersions(
  pool: Pick<Pool, "query">,
  pairs: readonly { organizationId: string; key: string }[],
): Promise<Map<string, TariffVersion[]>> {
  const out = new Map<string, TariffVersion[]>();
  if (pairs.length === 0) return out;
  const { rows } = await pool.query<VersionRow>(
    `WITH p AS (
       SELECT DISTINCT organization_id, key FROM unnest($1::uuid[], $2::varchar[]) AS p(organization_id, key)
     )
     SELECT p.organization_id AS pair_org, c.id, c.key, 'catalog' AS source, NULL::uuid AS organization_id,
            c.name, c.state, c.energy_unit, c.fixed_basis, c.data_status, to_char(c.effective_from, 'YYYY-MM-DD') AS effective_from,
            c.tariff_order, c.source_url,
            (SELECT json_agg(json_build_object('slab_no', s.slab_no, 'from_units', s.from_units, 'to_units', s.to_units,
                     'energy_rate', s.energy_rate, 'fixed_rate', s.fixed_rate, 'wheeling_rate', s.wheeling_rate, 'notes', s.notes)
                     ORDER BY s.slab_no)
               FROM bms.tariff_slabs s WHERE s.category_id = c.id) AS slabs
       FROM p JOIN bms.tariff_categories c ON c.key = p.key
     UNION ALL
     SELECT p.organization_id, o.id, o.key, 'organization', o.organization_id,
            o.name, o.state, o.energy_unit, o.fixed_basis, o.data_status, to_char(o.effective_from, 'YYYY-MM-DD'),
            o.tariff_order, o.source_url,
            (SELECT json_agg(json_build_object('slab_no', s.slab_no, 'from_units', s.from_units, 'to_units', s.to_units,
                     'energy_rate', s.energy_rate, 'fixed_rate', s.fixed_rate, 'wheeling_rate', s.wheeling_rate, 'notes', s.notes)
                     ORDER BY s.slab_no)
               FROM bms.org_tariff_slabs s WHERE s.category_id = o.id AND s.organization_id = o.organization_id)
       FROM p JOIN bms.org_tariff_categories o ON o.key = p.key AND o.organization_id = p.organization_id`,
    [pairs.map((p) => p.organizationId), pairs.map((p) => p.key)],
  );
  for (const r of rows) {
    const version: TariffVersion = {
      id: r.id,
      key: r.key,
      source: r.source,
      organizationId: r.organization_id,
      name: r.name,
      state: r.state,
      energyUnit: r.energy_unit,
      fixedBasis: r.fixed_basis,
      dataStatus: r.data_status,
      effectiveFrom: r.effective_from,
      tariffOrder: r.tariff_order,
      sourceUrl: r.source_url,
      slabs: (r.slabs ?? []).map((s) => ({
        slabNo: s.slab_no,
        fromUnits: Number(s.from_units),
        toUnits: s.to_units === null ? null : Number(s.to_units),
        energyRate: Number(s.energy_rate),
        fixedRate: Number(s.fixed_rate),
        wheelingRate: Number(s.wheeling_rate),
        notes: s.notes,
      })),
    };
    const k = pairKey(r.pair_org, r.key);
    const list = out.get(k);
    if (list) list.push(version);
    else out.set(k, [version]);
  }
  return out;
}
