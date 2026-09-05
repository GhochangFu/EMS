import { CALC_DIALECT_V2 } from "@bms/shared";
import type pg from "pg";

import { IT_LOAD_GROUP_CODE } from "./asset-groups-seed";
import { HEALTH_BASELINE_CONTENT } from "./asset-template-health-seed";

/**
 * `F2.8` — the demo PUE: one `bms-calc-v2` incomer template per organization,
 * pinned to each site's `incoming-supply` asset, and the two rows of demo data
 * its formulas need in order to resolve any member at all.
 *
 * **Why the demo pins a template instead of using the override (plan §3, §11
 * decision 1).** An override can only re-parameterise a point the pinned
 * template already declares: `resolveWritableContext` reads "the pinned
 * version's declaration of this point", and `calc-definitions.service` builds
 * every definition from `template_points WHERE kind = 'derived'` INNER JOINed
 * on `assets.template_id`, with `asset_points` only LEFT-joined as a coalesce.
 * `BASELINE-ELECTRICAL` declares seven measured points and nothing derived, so
 * the only way the engine ever sees `site_kw`, `it_kw` and `pue` on an incomer
 * is a template that declares them, pinned to that incomer. This module writes
 * that template — `BASELINE-ELECTRICAL-INCOMER` — as a copy of the electrical
 * baseline's measured points (so the nine assets keep their health band and
 * E1.3's donut loses nothing) plus the three derived rows.
 *
 * **Why `it_kw` reads `rack_kw` here and `kw` in the stock entry (plan §3.1).**
 * The stock `electrical-feeder` v2 says `sum({kw} @group('IT_LOAD'))`, because a
 * real incomer meters real IT feeders in `kw`. `apps/sim` emits `rack_kw` for
 * its fourteen IT assets and never `kw`, so the stock literal would resolve
 * fourteen members that carry no such reading and refuse every tick as
 * `coverage_below_floor`. The other two literals are byte-identical to the
 * stock ones; `tests/f2.8-pue-curve-is-gone.test.ts` reads both files as text
 * and holds the pair together.
 *
 * **What the seed writes, in order, and why the order is load-bearing.**
 *
 * 1. `PUE_DEMO_RACK_KW_POINTS_SQL` — one `unmapped` catalog row for `rack_kw`
 *    on each active IT asset. `readScopeMembers` admits an asset to an
 *    aggregate only if the key is declared "by template or by an active
 *    mapping"; the IT baseline declares only `pdu_util_pct`, so without this
 *    row `sum({rack_kw} @group('IT_LOAD'))` has zero members. Same shape as
 *    `seedRuledPointCatalog`'s rows (`unmapped`, `rtu_id NULL`, `SIM_` key),
 *    and the `asset_points_source_ref_check` constraint requires exactly that.
 * 2. `PUE_DEMO_TEMPLATE_SQL` — the incomer template, `published`, version 1,
 *    `asset_type 'baseline'` so `HEALTH_TEMPLATE_VERIFY_SQL`'s `unusable` check
 *    covers it on every later seed.
 * 3. `PUE_DEMO_TEMPLATE_POINTS_SQL` — the baseline's measured rows copied from
 *    `template_points` (not from `asset_points`, so the copy cannot pick up a
 *    key the baseline itself refused), plus the three derived rows. The
 *    dialect is a **parameter** (`CALC_DIALECT_V2`), never a literal.
 * 4. `PUE_DEMO_PIN_SQL` — moves each `incoming-supply` asset from
 *    `BASELINE-ELECTRICAL` to the incomer template. The role is the selector
 *    (ruling 1 read off data, §11 decision 3); naming the source template is
 *    what leaves an operator's own migration alone.
 * 5. `PUE_DEMO_VERIFY_SQL` — reads every write back, because the seed runs as
 *    `bms_owner` under `FORCE ROW LEVEL SECURITY` and a declined write is
 *    silent.
 *
 * It runs LAST in `seed.ts`'s ESKOM bracket: after `seedAssetGroups` (the role
 * and the `IT_LOAD` group), after `seedPointKeyCatalog` (`rack_kw` and the
 * three derived keys are FKs into `bms.point_keys`), and after
 * `seedAssetTemplateHealth` (the copy source, and the pin it moves).
 * `verifyHierarchySeed`'s three ESKOM PUE counts are what hold that order on a
 * cold database.
 *
 * **Idempotent under `compose up`.** Every statement is `DO NOTHING` or
 * predicated on the state it establishes, so the hundredth seed writes what
 * the first one wrote. The one hazard a re-seed had — `CalcWriteService`'s
 * `computed` rows for the three outputs being read back as measured
 * declarations on `BASELINE-ELECTRICAL` — is closed by the `source_kind <>
 * 'computed'` predicate in `HEALTH_TEMPLATE_POINTS_SQL`, not here.
 *
 * **Every derived row is `scheduled` at 60 s with `min_coverage_ratio NULL`**
 * — ADR 0055 decision 11's fail-closed default, relaxed only on an imported
 * draft — and `max_input_age_seconds NULL`, the engine's 300 s default. `pue`
 * reads two derived siblings on its own asset, which `v2` admits (decision 7)
 * and the scheduler resolves in the same tick through `computedThisTick`.
 */

/** The incomer template's code — the fifth `BASELINE-*` row, not a domain baseline. */
export const PUE_DEMO_TEMPLATE_CODE = "BASELINE-ELECTRICAL-INCOMER";

/** The domain baseline the measured points are copied from and the pin moves off. */
export const PUE_DEMO_SOURCE_TEMPLATE_CODE = "BASELINE-ELECTRICAL";

/** Ruling 1: the PUE point lives on "the site's `incoming-supply` asset". */
export const PUE_DEMO_INCOMER_ROLE = "incoming-supply";

/** §11 decision 5 — one minute, the same as the stock entry. */
export const PUE_DEMO_CALC_INTERVAL_SECONDS = 60;

/**
 * The three formulas. `it_kw` is the one deliberate divergence from the stock
 * `electrical-feeder` entry (module docblock); the other two are its literals.
 */
export const PUE_DEMO_FORMULAS = {
  site_kw: "sum({kw} @site)",
  it_kw: "sum({rack_kw} @group('IT_LOAD'))",
  pue: "{site_kw} / {it_kw}",
} as const;

export type PueDemoDerivedPoint = {
  readonly pointKey: keyof typeof PUE_DEMO_FORMULAS;
  readonly formula: string;
  readonly label: string;
  readonly unit: string | null;
  readonly sortOrder: number;
};

/** Sort orders 100-102 sit after any measured row the baseline copy carries. */
export const PUE_DEMO_DERIVED_POINTS: readonly PueDemoDerivedPoint[] = [
  {
    pointKey: "site_kw",
    formula: PUE_DEMO_FORMULAS.site_kw,
    label: "Site load (sum of kW at this site)",
    unit: "kW",
    sortOrder: 100,
  },
  {
    pointKey: "it_kw",
    formula: PUE_DEMO_FORMULAS.it_kw,
    label: "IT load (sum of rack kW, group IT_LOAD)",
    unit: "kW",
    sortOrder: 101,
  },
  {
    pointKey: "pue",
    formula: PUE_DEMO_FORMULAS.pue,
    label: "PUE",
    unit: null,
    sortOrder: 102,
  },
];

/**
 * One `rack_kw` catalog row per active IT asset, in `seedRuledPointCatalog`'s
 * shape. `LEFT JOIN` on the catalog for the unit, as that module does: the FK
 * on `point_key` is what refuses a key the catalog does not hold, and a NULL
 * unit must not drop the row.
 */
export const PUE_DEMO_RACK_KW_POINTS_SQL = `
INSERT INTO bms.asset_points
  (organization_id, asset_id, point_key, source_data_key, rtu_id, source_kind, unit, active)
SELECT
  $1::uuid,
  a.id,
  'rack_kw',
  'SIM_RACK_KW',
  NULL,
  'unmapped',
  pk.unit,
  true
FROM bms.assets a
LEFT JOIN bms.point_keys pk
  ON pk.code = 'rack_kw'
 AND pk.active = true
WHERE a.organization_id = $1
  AND a.active = true
  AND a.domain = 'it'
ON CONFLICT (asset_id, point_key) DO NOTHING
`;

/**
 * The incomer template, version 1, published. `DO NOTHING` rather than
 * `DO UPDATE` for the reason `HEALTH_TEMPLATE_SQL` gives: a published version
 * is immutable (ADR 0015) and an asset pins the version.
 */
export const PUE_DEMO_TEMPLATE_SQL = `
INSERT INTO bms.asset_templates
  (organization_id, code, version, name, asset_type, domain, description, status,
   content, published_at)
VALUES
  ($1::uuid,
   '${PUE_DEMO_TEMPLATE_CODE}',
   1,
   'Electrical Baseline (incomer, PUE)',
   'baseline',
   'electrical',
   'Seeded demo baseline for the site incomer. Carries the same health bands and measured points as ${PUE_DEMO_SOURCE_TEMPLATE_CODE}, plus the three scheduled derived points (site_kw, it_kw, pue) the PUE tile reads.',
   'published',
   $2::jsonb,
   now())
ON CONFLICT (organization_id, code, version) DO NOTHING
`;

/**
 * The measured copy and the three derived rows in one statement, so the
 * `ON CONFLICT` covers both halves. The first branch types every column; the
 * second's untyped literals resolve against it.
 */
export const PUE_DEMO_TEMPLATE_POINTS_SQL = `
INSERT INTO bms.template_points
  (organization_id, template_id, point_key, label, unit, kind, source_data_key_pattern,
   required, sort_order, meta, formula, formula_dialect, calc_trigger,
   calc_interval_seconds, max_input_age_seconds, min_coverage_ratio)
SELECT
  $1::uuid,
  incomer.id,
  src.point_key,
  src.label,
  src.unit,
  src.kind,
  src.source_data_key_pattern,
  src.required,
  src.sort_order,
  src.meta,
  NULL::text,
  NULL::varchar,
  NULL::varchar,
  NULL::int,
  NULL::int,
  NULL::double precision
FROM bms.asset_templates incomer
JOIN bms.asset_templates baseline
  ON baseline.organization_id = $1
 AND baseline.code = '${PUE_DEMO_SOURCE_TEMPLATE_CODE}'
 AND baseline.version = 1
JOIN bms.template_points src
  ON src.template_id = baseline.id
 AND src.kind = 'measured'
WHERE incomer.organization_id = $1
  AND incomer.code = '${PUE_DEMO_TEMPLATE_CODE}'
  AND incomer.version = 1
UNION ALL
SELECT
  $1::uuid,
  incomer.id,
  d.point_key,
  d.label,
  d.unit,
  'derived',
  NULL,
  false,
  d.sort_order,
  '{}'::jsonb,
  d.formula,
  $2::varchar,
  'scheduled',
  ${PUE_DEMO_CALC_INTERVAL_SECONDS},
  NULL,
  NULL
FROM bms.asset_templates incomer
CROSS JOIN unnest($3::varchar[], $4::text[], $5::varchar[], $6::varchar[], $7::int[])
  AS d(point_key, formula, label, unit, sort_order)
WHERE incomer.organization_id = $1
  AND incomer.code = '${PUE_DEMO_TEMPLATE_CODE}'
  AND incomer.version = 1
ON CONFLICT (template_id, point_key) DO NOTHING
`;

/**
 * Moves an `incoming-supply` asset from the domain baseline to the incomer
 * template. Only a `BASELINE-ELECTRICAL` pin moves: an asset an operator has
 * migrated elsewhere (ADR 0039's explicit, previewed and audited path) keeps
 * that pin, and one already on the incomer template matches nothing.
 * `incomer.domain = a.domain` is the same cross-domain guard
 * `HEALTH_TEMPLATE_PIN_SQL` carries.
 */
export const PUE_DEMO_PIN_SQL = `
UPDATE bms.assets a
SET template_id = incomer.id
FROM bms.asset_templates incomer,
     bms.asset_templates baseline
WHERE a.organization_id = $1
  AND a.active = true
  AND incomer.organization_id = $1
  AND incomer.code = '${PUE_DEMO_TEMPLATE_CODE}'
  AND incomer.version = 1
  AND incomer.domain = a.domain
  AND baseline.organization_id = $1
  AND baseline.code = '${PUE_DEMO_SOURCE_TEMPLATE_CODE}'
  AND baseline.version = 1
  AND a.template_id = baseline.id
  AND EXISTS (
    SELECT 1
    FROM bms.asset_group_members agm
    WHERE agm.asset_id = a.id
      AND agm.role = '${PUE_DEMO_INCOMER_ROLE}'
  )
`;

/**
 * The post-condition. Zero-uncovered counts rather than totals (the migration
 * review of PR #100's rule — a total cannot tell "every asset got its row"
 * from "most did, one silently did not"), plus the derived-row count and one
 * anti-vacuity total. The absolute cardinalities — 9 incomers, 14 members, 14
 * rows — are `verifyHierarchySeed`'s, the boot gate, which is also the only
 * place the seed *order* is proved.
 */
export const PUE_DEMO_VERIFY_SQL = `
SELECT
  (
    SELECT count(*)::int
    FROM bms.assets a
    WHERE a.organization_id = $1
      AND a.active = true
      AND a.domain = 'it'
      AND NOT EXISTS (
        SELECT 1 FROM bms.asset_points ap
        WHERE ap.asset_id = a.id
          AND ap.point_key = 'rack_kw'
          AND ap.active = true
      )
  ) AS it_assets_without_rack_kw,
  (
    SELECT count(*)::int
    FROM bms.assets a
    WHERE a.organization_id = $1
      AND a.active = true
      AND a.domain = 'it'
      AND NOT EXISTS (
        SELECT 1
        FROM bms.asset_group_members agm
        JOIN bms.asset_groups ag ON ag.id = agm.asset_group_id
        WHERE agm.asset_id = a.id
          AND ag.code = '${IT_LOAD_GROUP_CODE}'
      )
  ) AS it_assets_outside_it_load,
  (
    SELECT count(*)::int
    FROM bms.assets a
    JOIN bms.asset_templates t ON t.id = a.template_id
    WHERE a.organization_id = $1
      AND a.active = true
      AND t.code = '${PUE_DEMO_SOURCE_TEMPLATE_CODE}'
      AND EXISTS (
        SELECT 1 FROM bms.asset_group_members agm
        WHERE agm.asset_id = a.id
          AND agm.role = '${PUE_DEMO_INCOMER_ROLE}'
      )
  ) AS incomers_still_on_the_baseline,
  (
    SELECT count(*)::int
    FROM bms.template_points tp
    JOIN bms.asset_templates t ON t.id = tp.template_id
    WHERE t.organization_id = $1
      AND t.code = '${PUE_DEMO_TEMPLATE_CODE}'
      AND t.version = 1
      AND tp.kind = 'derived'
  ) AS derived_points,
  (
    SELECT count(*)::int
    FROM bms.assets a
    JOIN bms.asset_templates t ON t.id = a.template_id
    WHERE a.organization_id = $1
      AND t.code = '${PUE_DEMO_TEMPLATE_CODE}'
  ) AS pinned_incomers
`;

/** `[organizationId, content]` — the same bands the four domain baselines carry. */
export function pueDemoTemplateParams(organizationId: string): [string, string] {
  return [organizationId, JSON.stringify(HEALTH_BASELINE_CONTENT)];
}

/**
 * `[organizationId, dialect, keys, formulas, labels, units, sortOrders]`.
 * Exported so the spec can hold that the dialect is `CALC_DIALECT_V2` and
 * reaches the statement as `$2`, never as a literal.
 */
export function pueDemoTemplatePointsParams(organizationId: string): unknown[] {
  return [
    organizationId,
    CALC_DIALECT_V2,
    PUE_DEMO_DERIVED_POINTS.map((point) => point.pointKey),
    PUE_DEMO_DERIVED_POINTS.map((point) => point.formula),
    PUE_DEMO_DERIVED_POINTS.map((point) => point.label),
    PUE_DEMO_DERIVED_POINTS.map((point) => point.unit),
    PUE_DEMO_DERIVED_POINTS.map((point) => point.sortOrder),
  ];
}

type PueDemoVerifyRow = {
  it_assets_without_rack_kw: number;
  it_assets_outside_it_load: number;
  incomers_still_on_the_baseline: number;
  derived_points: number;
  pinned_incomers: number;
};

/**
 * Seeds the demo PUE and proves it landed. Called inside the organization's
 * `withOrganization` bracket, so every statement runs in that transaction with
 * the tenant GUC set. A `rowCount` of 0 is the correct answer on a re-seed and
 * is not a failure; the post-condition is what fails.
 */
export async function seedPueDemo(
  pool: pg.Pool,
  organizationId: string,
): Promise<{ rackKwPoints: number; templates: number; templatePoints: number; pinned: number }> {
  const rackKw = await pool.query(PUE_DEMO_RACK_KW_POINTS_SQL, [organizationId]);
  const templates = await pool.query(PUE_DEMO_TEMPLATE_SQL, pueDemoTemplateParams(organizationId));
  const points = await pool.query(
    PUE_DEMO_TEMPLATE_POINTS_SQL,
    pueDemoTemplatePointsParams(organizationId),
  );
  const pinned = await pool.query(PUE_DEMO_PIN_SQL, [organizationId]);

  const check = await pool.query<PueDemoVerifyRow>(PUE_DEMO_VERIFY_SQL, [organizationId]);
  const row = check.rows[0];
  const withoutRackKw = row?.it_assets_without_rack_kw ?? -1;
  const outsideItLoad = row?.it_assets_outside_it_load ?? -1;
  const stillOnBaseline = row?.incomers_still_on_the_baseline ?? -1;
  const derived = row?.derived_points ?? -1;
  const pinnedIncomers = row?.pinned_incomers ?? -1;
  if (
    withoutRackKw !== 0 ||
    outsideItLoad !== 0 ||
    stillOnBaseline !== 0 ||
    derived !== PUE_DEMO_DERIVED_POINTS.length ||
    pinnedIncomers < 1
  ) {
    throw new Error(
      `seedPueDemo: ${withoutRackKw} IT asset(s) have no rack_kw catalog row, ${outsideItLoad} ` +
        `are outside ${IT_LOAD_GROUP_CODE}, ${stillOnBaseline} incomer(s) are still on ` +
        `${PUE_DEMO_SOURCE_TEMPLATE_CODE}, ${PUE_DEMO_TEMPLATE_CODE} declares ${derived} derived ` +
        `point(s) (wanted ${PUE_DEMO_DERIVED_POINTS.length}) and ${pinnedIncomers} asset(s) are ` +
        "pinned to it. A FORCE-RLS write can drop rows without raising, so each is read back " +
        "rather than inferred from the statements completing.",
    );
  }

  return {
    rackKwPoints: rackKw.rowCount ?? 0,
    templates: templates.rowCount ?? 0,
    templatePoints: points.rowCount ?? 0,
    pinned: pinned.rowCount ?? 0,
  };
}
