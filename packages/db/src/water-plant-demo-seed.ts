import { CALC_DIALECT_V3 } from "@bms/shared";
import type pg from "pg";

import type { EskomAssetSpec } from "./eskom-assets-seed";

/**
 * `E4.3` U11 — the demo water plant (ADR 0073 decision 6, owner rulings Q3,
 * Q4, Q7, Q10, Q11): five water assets at CSMOC Gauteng, one per stock water
 * class the balance reads — WTP `intake`, RO and cooling tower `internal`, STP
 * `reuse`, ETP `discharge` — each pinned to a seed-side MIRROR template and
 * carrying its balance role, so `water.balance` and the `balanceRole: "intake"`
 * tiles of `sustainability-overview` v4 have a site to read on the demo.
 *
 * **Why a mirror and not the stock template (plan fact 11, ruling Q3).** The
 * stock catalog lives in `apps/api/src/admin/asset-templates/stock-catalog/`;
 * `packages/db` imports nothing from `apps/api`, and the seed runs before the
 * API exists (the compose `migrate` service). So this module writes
 * `DEMO-WATER-<CLASS>` version 1 by raw SQL, the way every seeded template is
 * written (`pue-demo-seed.ts`), with `stock_code`/`stock_version` left NULL —
 * a mirror is not an import, and the F2.13 stamp would claim one. The six
 * volume formulas per class are spelled here EXACTLY as the stock modules
 * spell them; `tests/e4.3-demo-water-plant.test.ts` reads both files as text
 * and fails on a single byte of drift.
 *
 * **What a mirror carries (ruling Q11).** The flow rows its formulas read,
 * measured, plus the six volume rows — `kl_today/_this_month/_this_year` over
 * the class's inlet and `outlet_kl_*` over its outlet. Omitted:
 * `water_cost_*` (it needs `$water_tariff_per_kl`, which ESKOM does not set —
 * every tick would refuse `parameter_unset`), `water_saving_vs_baseline_pct`,
 * `recovery_pct`, and the stock alarm and health content. The demo's subject
 * is the balance, not those. The `content` is `{ contentVersion: 1 }`, which
 * `templateContentSchema` accepts; these assets carry no health band.
 *
 * **Where it runs, and why both sides are load-bearing (`seed.ts`).** After
 * `seedPointKeyCatalog`, because `template_points.point_key` and
 * `asset_points.point_key` are FKs into `bms.point_keys` (`0058`). BEFORE
 * `seedAssetTemplateHealth`, because that module pins every
 * `template_id IS NULL` asset of a domain to `BASELINE-<DOMAIN>`: run after it
 * on a cold database, the five assets would be pinned to a `BASELINE-WATER`
 * that declares no point (the flow rows are written here, so they would not
 * exist yet), and `seedAssetTemplateHealth` would throw `unusable = 1` and
 * stop the boot. `BASELINE-WATER` itself is created in either order —
 * `HEALTH_TEMPLATE_SQL` makes one per domain that has an active asset, pinned
 * or not — and in this order it declares the distinct flow keys written here
 * (nine: the STP and the ETP both carry `influent_flow_klh`) and pins no
 * asset. The assets themselves come from `eskom-assets-seed.ts`
 * ({@link DEMO_WATER_PLANT_ASSETS}, last in the catalog), and their RTU from
 * `DOMAIN_RTU_SUFFIX`'s `water: "WATER"` (ruling Q4), which
 * `assignEskomAssetRtus` applies to a water asset only when its code starts
 * with `WTR-` (ruling R3).
 *
 * **Tenant context.** Called inside the ESKOM `withOrganization` bracket, so
 * every statement below — including the post-condition read-back — runs in
 * that transaction with `app.current_organization` set, on the seed's
 * `max: 1` pool (`seed-tenant.ts`). The seed connects as `bms_owner` under
 * `FORCE ROW LEVEL SECURITY`: an UPDATE outside the context changes zero rows
 * without raising, and a read-back outside it proves nothing. That is why the
 * post-condition is a `SELECT`, not a `rowCount`.
 *
 * **Idempotent under `compose up`.** Templates and points are
 * `ON CONFLICT DO NOTHING` (a published version is immutable, ADR 0015); the
 * pin and the role are written by one UPDATE predicated on
 * `template_id IS NULL`, so a re-seed never moves a pin an operator set, and
 * never rewrites the role of a pinned asset. The seed does not accept every
 * such change, though. The post-condition below requires each of the five
 * assets to be pinned to its OWN class's mirror (any version of that code)
 * and to carry a non-null role, so an operator who re-pins a demo asset to
 * any other template, or clears its role, fails the next boot. A change from
 * one non-null role to another passes the post-condition.
 * `verify-hierarchy-seed.ts`'s water counts fail on a cleared role, on a pin
 * to a template whose code does not start with `DEMO-WATER-`, and on an
 * intake count other than one; its pin count does not see a swap between two
 * mirrors. The seed never overwrites the change; it refuses it loudly.
 */

/** The site the plant is seeded at — ruling Q10. */
export const DEMO_WATER_SITE_NAME = "CSMOC Gauteng";

/** §11 decision 5 of F2.8 and the stock `derived(…)` spread — one minute. */
export const DEMO_WATER_CALC_INTERVAL_SECONDS = 60;

/** A measured flow row, mirrored from the stock class's own declaration. */
export type DemoWaterFlowRow = {
  readonly pointKey: string;
  readonly label: string;
  readonly required: boolean;
  readonly tier: "core" | "extended";
  readonly sortOrder: number;
};

/** A derived volume row; `formula` is the stock literal, byte for byte. */
export type DemoWaterDerivedRow = {
  readonly pointKey: string;
  readonly formula: string;
  readonly label: string;
  readonly sortOrder: number;
};

export type DemoWaterClass = {
  readonly assetCode: string;
  readonly assetName: string;
  readonly stockClass: string;
  readonly templateCode: string;
  readonly templateName: string;
  readonly assetType: string;
  /** A `bms.water_balance_roles` code (migration `0080`). */
  readonly role: string;
  /** The flows the six formulas read — the drift test holds the containment. */
  readonly measuredFlowKeys: readonly string[];
  readonly flowRows: readonly DemoWaterFlowRow[];
  readonly derivedRows: readonly DemoWaterDerivedRow[];
};

const TODAY = "Inlet water today";
const MONTH = "Inlet water this month (calendar, estimated over the whole period)";
const YEAR = "Inlet water this year (calendar, estimated over the whole period)";
const OUT_TODAY = "Outlet water today";
const OUT_MONTH = "Outlet water this month (calendar, estimated over the whole period)";
const OUT_YEAR = "Outlet water this year (calendar, estimated over the whole period)";

/**
 * The five classes. Each class is ONE object literal whose derived rows spell
 * `pointKey: "<code>"` and `formula: "<stock literal>"` inline — the drift test
 * scopes its parse to the literal holding `assetCode: "<code>"`, so do not
 * factor the formulas into a helper or a shared constant: the test would stop
 * finding them and fail closed. Labels and sort orders follow the stock rows.
 */
export const DEMO_WATER_CLASSES: readonly DemoWaterClass[] = [
  {
    assetCode: "WTR-WTP-01",
    assetName: "Demo Water Treatment Plant",
    stockClass: "water-wtp",
    templateCode: "DEMO-WATER-WTP",
    templateName: "Demo water treatment plant (balance mirror)",
    assetType: "wtp",
    role: "intake",
    measuredFlowKeys: ["raw_water_flow_klh", "treated_water_flow_klh"],
    flowRows: [
      { pointKey: "raw_water_flow_klh", label: "Raw water intake flow", required: true, tier: "core", sortOrder: 0 },
      { pointKey: "treated_water_flow_klh", label: "Treated water outlet flow", required: true, tier: "core", sortOrder: 10 },
    ],
    derivedRows: [
      { pointKey: "kl_today", formula: "sum({raw_water_flow_klh}, today)", label: TODAY, sortOrder: 20 },
      { pointKey: "kl_this_month", formula: "sum({raw_water_flow_klh}, this_month)", label: MONTH, sortOrder: 23 },
      { pointKey: "kl_this_year", formula: "sum({raw_water_flow_klh}, this_year)", label: YEAR, sortOrder: 24 },
      { pointKey: "outlet_kl_today", formula: "sum({treated_water_flow_klh}, today)", label: OUT_TODAY, sortOrder: 27 },
      { pointKey: "outlet_kl_this_month", formula: "sum({treated_water_flow_klh}, this_month)", label: OUT_MONTH, sortOrder: 28 },
      { pointKey: "outlet_kl_this_year", formula: "sum({treated_water_flow_klh}, this_year)", label: OUT_YEAR, sortOrder: 29 },
    ],
  },
  {
    assetCode: "WTR-RO-01",
    assetName: "Demo Reverse Osmosis Skid",
    stockClass: "water-ro",
    templateCode: "DEMO-WATER-RO",
    templateName: "Demo reverse osmosis skid (balance mirror)",
    assetType: "ro_skid",
    role: "internal",
    measuredFlowKeys: ["feed_flow_klh", "permeate_flow_klh"],
    flowRows: [
      { pointKey: "feed_flow_klh", label: "Feed water flow", required: true, tier: "core", sortOrder: 0 },
      { pointKey: "permeate_flow_klh", label: "Permeate flow", required: true, tier: "core", sortOrder: 1 },
    ],
    derivedRows: [
      { pointKey: "kl_today", formula: "sum({feed_flow_klh}, today)", label: TODAY, sortOrder: 18 },
      { pointKey: "kl_this_month", formula: "sum({feed_flow_klh}, this_month)", label: MONTH, sortOrder: 21 },
      { pointKey: "kl_this_year", formula: "sum({feed_flow_klh}, this_year)", label: YEAR, sortOrder: 22 },
      { pointKey: "outlet_kl_today", formula: "sum({permeate_flow_klh}, today)", label: OUT_TODAY, sortOrder: 25 },
      { pointKey: "outlet_kl_this_month", formula: "sum({permeate_flow_klh}, this_month)", label: OUT_MONTH, sortOrder: 26 },
      { pointKey: "outlet_kl_this_year", formula: "sum({permeate_flow_klh}, this_year)", label: OUT_YEAR, sortOrder: 27 },
    ],
  },
  {
    assetCode: "WTR-CT-01",
    assetName: "Demo Cooling Tower",
    stockClass: "water-cooling-tower",
    templateCode: "DEMO-WATER-CT",
    templateName: "Demo cooling tower (balance mirror)",
    assetType: "cooling_tower",
    role: "internal",
    measuredFlowKeys: ["makeup_flow_klh", "blowdown_flow_klh"],
    flowRows: [
      { pointKey: "makeup_flow_klh", label: "Make-up water flow", required: true, tier: "core", sortOrder: 4 },
      { pointKey: "blowdown_flow_klh", label: "Blowdown flow", required: false, tier: "extended", sortOrder: 5 },
    ],
    derivedRows: [
      { pointKey: "kl_today", formula: "sum({makeup_flow_klh}, today)", label: TODAY, sortOrder: 21 },
      { pointKey: "kl_this_month", formula: "sum({makeup_flow_klh}, this_month)", label: MONTH, sortOrder: 24 },
      { pointKey: "kl_this_year", formula: "sum({makeup_flow_klh}, this_year)", label: YEAR, sortOrder: 25 },
      { pointKey: "outlet_kl_today", formula: "sum({blowdown_flow_klh}, today)", label: OUT_TODAY, sortOrder: 28 },
      { pointKey: "outlet_kl_this_month", formula: "sum({blowdown_flow_klh}, this_month)", label: OUT_MONTH, sortOrder: 29 },
      { pointKey: "outlet_kl_this_year", formula: "sum({blowdown_flow_klh}, this_year)", label: OUT_YEAR, sortOrder: 30 },
    ],
  },
  {
    assetCode: "WTR-STP-01",
    assetName: "Demo Sewage Treatment Plant",
    stockClass: "water-stp",
    templateCode: "DEMO-WATER-STP",
    templateName: "Demo sewage treatment plant (balance mirror)",
    assetType: "stp",
    role: "reuse",
    measuredFlowKeys: ["influent_flow_klh", "effluent_flow_klh"],
    flowRows: [
      { pointKey: "influent_flow_klh", label: "Influent flow", required: true, tier: "core", sortOrder: 0 },
      { pointKey: "effluent_flow_klh", label: "Treated effluent flow", required: true, tier: "core", sortOrder: 1 },
    ],
    derivedRows: [
      { pointKey: "kl_today", formula: "sum({influent_flow_klh}, today)", label: TODAY, sortOrder: 18 },
      { pointKey: "kl_this_month", formula: "sum({influent_flow_klh}, this_month)", label: MONTH, sortOrder: 21 },
      { pointKey: "kl_this_year", formula: "sum({influent_flow_klh}, this_year)", label: YEAR, sortOrder: 22 },
      { pointKey: "outlet_kl_today", formula: "sum({effluent_flow_klh}, today)", label: OUT_TODAY, sortOrder: 25 },
      { pointKey: "outlet_kl_this_month", formula: "sum({effluent_flow_klh}, this_month)", label: OUT_MONTH, sortOrder: 26 },
      { pointKey: "outlet_kl_this_year", formula: "sum({effluent_flow_klh}, this_year)", label: OUT_YEAR, sortOrder: 27 },
    ],
  },
  {
    assetCode: "WTR-ETP-01",
    assetName: "Demo Effluent Treatment Plant",
    stockClass: "water-etp",
    templateCode: "DEMO-WATER-ETP",
    templateName: "Demo effluent treatment plant (balance mirror)",
    assetType: "etp",
    role: "discharge",
    measuredFlowKeys: ["influent_flow_klh", "discharge_flow_klh"],
    flowRows: [
      { pointKey: "influent_flow_klh", label: "Raw effluent inlet flow", required: true, tier: "core", sortOrder: 0 },
      { pointKey: "discharge_flow_klh", label: "Final discharge flow", required: true, tier: "core", sortOrder: 8 },
    ],
    derivedRows: [
      { pointKey: "kl_today", formula: "sum({influent_flow_klh}, today)", label: TODAY, sortOrder: 17 },
      { pointKey: "kl_this_month", formula: "sum({influent_flow_klh}, this_month)", label: MONTH, sortOrder: 20 },
      { pointKey: "kl_this_year", formula: "sum({influent_flow_klh}, this_year)", label: YEAR, sortOrder: 21 },
      { pointKey: "outlet_kl_today", formula: "sum({discharge_flow_klh}, today)", label: OUT_TODAY, sortOrder: 24 },
      { pointKey: "outlet_kl_this_month", formula: "sum({discharge_flow_klh}, this_month)", label: OUT_MONTH, sortOrder: 25 },
      { pointKey: "outlet_kl_this_year", formula: "sum({discharge_flow_klh}, this_year)", label: OUT_YEAR, sortOrder: 26 },
    ],
  },
];

/**
 * The five demo asset codes — the one list the post-condition below and
 * `verify-hierarchy-seed.ts`'s four water counts scope to (owner ruling R1,
 * 2026-09-24), so another water asset in ESKOM cannot move either count.
 */
export const DEMO_WATER_ASSET_CODES: readonly string[] = DEMO_WATER_CLASSES.map((c) => c.assetCode);

/**
 * The five mirror template codes, in the order of {@link DEMO_WATER_ASSET_CODES}
 * — both are one `map` over `DEMO_WATER_CLASSES`, so entry `i` of each names
 * the same class. The post-condition reads exactly these codes, never a
 * `DEMO-WATER-` prefix: an administrator's own `DEMO-WATER-PILOT` version 1
 * would otherwise add its points to the count and stop the boot.
 */
export const DEMO_WATER_TEMPLATE_CODES: readonly string[] = DEMO_WATER_CLASSES.map((c) => c.templateCode);

/**
 * The five assets as `buildEskomAssetCatalog` entries, appended LAST in that
 * catalog so its load-bearing order (the alarm seed keys off the first two
 * entries) is untouched.
 */
export const DEMO_WATER_PLANT_ASSETS: readonly EskomAssetSpec[] = DEMO_WATER_CLASSES.map((c) => ({
  code: c.assetCode,
  name: c.assetName,
  siteName: DEMO_WATER_SITE_NAME,
  domain: "water",
}));

/** Every template point the five mirrors declare: measured flows plus volume rows. */
export const DEMO_WATER_TEMPLATE_POINT_TOTAL = DEMO_WATER_CLASSES.reduce(
  (total, c) => total + c.flowRows.length + c.derivedRows.length,
  0,
);

/** A published version 1. `DO NOTHING`: a published version is immutable (ADR 0015). */
export const DEMO_WATER_TEMPLATE_SQL = `
INSERT INTO bms.asset_templates
  (organization_id, code, version, name, asset_type, domain, description, status,
   content, published_at)
VALUES
  ($1::uuid, $2, 1, $3, $4, 'water',
   'Seeded demo mirror of the stock water class (E4.3, ADR 0073 decision 6): the flows the balance reads and the six volume rows, formulas held equal to the stock module by a drift test.',
   'published',
   '{"contentVersion":1}'::jsonb,
   now())
ON CONFLICT (organization_id, code, version) DO NOTHING
`;

/**
 * The measured flow rows and the derived volume rows of one mirror, in one
 * statement. A derived row carries the stock spread: scheduled at 60 s, the
 * dialect as a PARAMETER (`$3`, `CALC_DIALECT_V3`), `max_input_age_seconds`
 * and `min_coverage_ratio` NULL (ADR 0055 decision 11's fail-closed default).
 * A measured row carries none of those, and `meta.tier` as the stock row does.
 */
export const DEMO_WATER_TEMPLATE_POINTS_SQL = `
INSERT INTO bms.template_points
  (organization_id, template_id, point_key, label, unit, kind, source_data_key_pattern,
   required, sort_order, meta, formula, formula_dialect, calc_trigger,
   calc_interval_seconds, max_input_age_seconds, min_coverage_ratio)
SELECT
  $1::uuid,
  t.id,
  d.point_key,
  d.label,
  d.unit,
  d.kind,
  NULL,
  d.required,
  d.sort_order,
  CASE WHEN d.tier IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('tier', d.tier) END,
  d.formula,
  CASE WHEN d.kind = 'derived' THEN $3::varchar END,
  CASE WHEN d.kind = 'derived' THEN 'scheduled' END,
  CASE WHEN d.kind = 'derived' THEN ${DEMO_WATER_CALC_INTERVAL_SECONDS} END,
  NULL::int,
  NULL::double precision
FROM bms.asset_templates t
CROSS JOIN unnest($4::varchar[], $5::varchar[], $6::varchar[], $7::varchar[],
                  $8::boolean[], $9::int[], $10::varchar[], $11::text[])
  AS d(point_key, label, unit, kind, required, sort_order, tier, formula)
WHERE t.organization_id = $1
  AND t.code = $2
  AND t.version = 1
ON CONFLICT (template_id, point_key) DO NOTHING
`;

/**
 * One `unmapped` catalog row per measured flow, in the `rack_kw` shape
 * (`PUE_DEMO_RACK_KW_POINTS_SQL`), so the asset browser lists the flows and
 * `readScopeMembers` sees them declared. `rtu_id` is NULL because
 * `asset_points_source_ref_check` requires it for `unmapped`.
 */
export const DEMO_WATER_FLOW_POINTS_SQL = `
INSERT INTO bms.asset_points
  (organization_id, asset_id, point_key, source_data_key, rtu_id, source_kind, unit, active)
SELECT
  $1::uuid,
  a.id,
  f.point_key,
  'SIM_' || upper(f.point_key),
  NULL,
  'unmapped',
  pk.unit,
  true
FROM bms.assets a
CROSS JOIN unnest($3::varchar[]) AS f(point_key)
LEFT JOIN bms.point_keys pk
  ON pk.code = f.point_key
 AND pk.active = true
WHERE a.organization_id = $1
  AND a.code = $2
  AND a.domain = 'water'
ON CONFLICT (asset_id, point_key) DO NOTHING
`;

/**
 * The pin and the balance role, together, only while the asset has NO pin.
 * An asset an operator has migrated elsewhere (ADR 0039) keeps that pin and
 * its role; `t.domain = a.domain` is the cross-domain guard
 * `HEALTH_TEMPLATE_PIN_SQL` carries.
 */
export const DEMO_WATER_PIN_SQL = `
UPDATE bms.assets a
SET template_id = t.id,
    water_balance_role = $3
FROM bms.asset_templates t
WHERE a.organization_id = $1
  AND a.code = $2
  AND a.template_id IS NULL
  AND t.organization_id = $1
  AND t.code = $4
  AND t.version = 1
  AND t.domain = a.domain
`;

/**
 * The post-condition, read back inside the same tenant bracket: how many of
 * the five `(asset code, template code)` pairs have the asset pinned to its
 * OWN class's mirror (`$2` and `$5` zipped — a WTP pinned to `DEMO-WATER-ETP`
 * does not count), how many of the five assets carry a balance role, how many
 * template points the five mirror codes declare at version 1 (`$5` exactly, no
 * prefix match), and how many `(asset code, flow key)` pairs have a catalog
 * row. The pin is matched by template code, not version, so an ADR 0039 move
 * to a later version of the same mirror still counts. The last count is
 * existence only — no `ap.active` — for `PUE_DEMO_VERIFY_SQL`'s reason: every
 * write here is `DO NOTHING` and cannot re-activate a row an administrator
 * deactivated, so an `active` predicate would fail every later boot. Params:
 * {@link demoWaterVerifyParams}.
 */
export const DEMO_WATER_VERIFY_SQL = `
SELECT
  (
    SELECT count(*)::int
    FROM unnest($2::varchar[], $5::varchar[]) AS p(asset_code, template_code)
    WHERE EXISTS (
      SELECT 1
      FROM bms.assets a
      JOIN bms.asset_templates t ON t.id = a.template_id
      WHERE a.organization_id = $1
        AND a.code = p.asset_code
        AND t.code = p.template_code
    )
  ) AS pinned,
  (
    SELECT count(*)::int
    FROM bms.assets a
    WHERE a.organization_id = $1
      AND a.code = ANY($2::varchar[])
      AND a.water_balance_role IS NOT NULL
  ) AS roled,
  (
    SELECT count(*)::int
    FROM bms.template_points tp
    JOIN bms.asset_templates t ON t.id = tp.template_id
    WHERE t.organization_id = $1
      AND t.code = ANY($5::varchar[])
      AND t.version = 1
  ) AS template_points,
  (
    SELECT count(*)::int
    FROM unnest($3::varchar[], $4::varchar[]) AS e(asset_code, point_key)
    WHERE EXISTS (
      SELECT 1
      FROM bms.asset_points ap
      JOIN bms.assets a ON a.id = ap.asset_id
      WHERE a.organization_id = $1
        AND a.code = e.asset_code
        AND ap.point_key = e.point_key
    )
  ) AS flow_points
`;

/** `[org, code, dialect, keys, labels, units, kinds, required, sortOrders, tiers, formulas]`. */
export function demoWaterTemplatePointsParams(organizationId: string, c: DemoWaterClass): unknown[] {
  const measured = c.flowRows.map((row) => ({
    pointKey: row.pointKey,
    label: row.label,
    unit: "KL/hr",
    kind: "measured",
    required: row.required,
    sortOrder: row.sortOrder,
    tier: row.tier as string | null,
    formula: null as string | null,
  }));
  const derivedRows = c.derivedRows.map((row) => ({
    pointKey: row.pointKey,
    label: row.label,
    unit: "KL",
    kind: "derived",
    required: false,
    sortOrder: row.sortOrder,
    tier: null as string | null,
    formula: row.formula as string | null,
  }));
  const rows = [...measured, ...derivedRows];
  return [
    organizationId,
    c.templateCode,
    CALC_DIALECT_V3,
    rows.map((row) => row.pointKey),
    rows.map((row) => row.label),
    rows.map((row) => row.unit),
    rows.map((row) => row.kind),
    rows.map((row) => row.required),
    rows.map((row) => row.sortOrder),
    rows.map((row) => row.tier),
    rows.map((row) => row.formula),
  ];
}

type DemoWaterVerifyRow = {
  pinned: number;
  roled: number;
  template_points: number;
  flow_points: number;
};

/** Every `(asset code, flow key)` pair the module writes a catalog row for. */
const DEMO_WATER_FLOW_PAIRS = DEMO_WATER_CLASSES.flatMap((c) =>
  c.measuredFlowKeys.map((pointKey) => ({ assetCode: c.assetCode, pointKey })),
);

/**
 * `[org, assetCodes, flowPairAssetCodes, flowPairPointKeys, templateCodes]` —
 * the params of {@link DEMO_WATER_VERIFY_SQL}. `$2` and `$5` are zipped by
 * position, so entry `i` of each must name the same class.
 */
export function demoWaterVerifyParams(organizationId: string): unknown[] {
  return [
    organizationId,
    DEMO_WATER_ASSET_CODES,
    DEMO_WATER_FLOW_PAIRS.map((pair) => pair.assetCode),
    DEMO_WATER_FLOW_PAIRS.map((pair) => pair.pointKey),
    DEMO_WATER_TEMPLATE_CODES,
  ];
}

/**
 * Seeds the five mirror templates, the flow catalog rows, the pins and the
 * roles, and proves all of it. Must run inside the ESKOM `withOrganization`
 * bracket (module docblock). A `rowCount` of 0 is the correct answer on a
 * re-seed; the post-condition is what fails.
 */
export async function seedWaterPlantDemo(
  pool: pg.Pool,
  organizationId: string,
): Promise<{ templates: number; templatePoints: number; flowPoints: number; pinned: number }> {
  let templates = 0;
  let templatePoints = 0;
  let flowPoints = 0;
  let pinned = 0;
  for (const c of DEMO_WATER_CLASSES) {
    const t = await pool.query(DEMO_WATER_TEMPLATE_SQL, [
      organizationId,
      c.templateCode,
      c.templateName,
      c.assetType,
    ]);
    templates += t.rowCount ?? 0;
    const tp = await pool.query(DEMO_WATER_TEMPLATE_POINTS_SQL, demoWaterTemplatePointsParams(organizationId, c));
    templatePoints += tp.rowCount ?? 0;
    const ap = await pool.query(DEMO_WATER_FLOW_POINTS_SQL, [organizationId, c.assetCode, c.measuredFlowKeys]);
    flowPoints += ap.rowCount ?? 0;
    const pin = await pool.query(DEMO_WATER_PIN_SQL, [organizationId, c.assetCode, c.role, c.templateCode]);
    pinned += pin.rowCount ?? 0;
  }

  const check = await pool.query<DemoWaterVerifyRow>(DEMO_WATER_VERIFY_SQL, demoWaterVerifyParams(organizationId));
  const row = check.rows[0];
  const pinnedNow = row?.pinned ?? -1;
  const roledNow = row?.roled ?? -1;
  const pointsNow = row?.template_points ?? -1;
  const flowsNow = row?.flow_points ?? -1;
  if (
    pinnedNow !== DEMO_WATER_CLASSES.length ||
    roledNow !== DEMO_WATER_CLASSES.length ||
    pointsNow !== DEMO_WATER_TEMPLATE_POINT_TOTAL ||
    flowsNow !== DEMO_WATER_FLOW_PAIRS.length
  ) {
    throw new Error(
      `seedWaterPlantDemo: ${pinnedNow} of ${DEMO_WATER_CLASSES.length} demo water assets are pinned ` +
        `to their own class's DEMO-WATER template, ${roledNow} carry a water balance role, and the mirrors declare ` +
        `${pointsNow} template point(s) (wanted ${DEMO_WATER_TEMPLATE_POINT_TOTAL}), and ${flowsNow} of ` +
        `${DEMO_WATER_FLOW_PAIRS.length} flow catalog rows exist. A FORCE-RLS write ` +
        "can drop rows without raising, so each is read back rather than inferred from the " +
        "statements completing. If the assets are missing, check that seed.ts runs this before " +
        "seedAssetTemplateHealth and inside the ESKOM tenant bracket.",
    );
  }

  return { templates, templatePoints, flowPoints, pinned };
}
