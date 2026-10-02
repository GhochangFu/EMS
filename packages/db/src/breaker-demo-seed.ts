import type pg from "pg";

import { demoRoleForAsset } from "./asset-groups-seed";

/**
 * `F3.74` plan D11 (ADR 0088 decisions 13 and 14, Amendment 1 D11) — the breaker demo at `RSMOC-WC`.
 *
 * **What this seeds, at the row `seedEskomLocations` resolved for `RSMOC-WC` only** (owner ruling
 * 17: never a row found by code). Five steps, each scoped to that location:
 *
 *  1. **The breaker roles, seeded once.** The twelve `CR-Q*` memberships in the site's `electrical`
 *     group take the role `demoRoleForAsset` gives them (`CR_BREAKER_ROLES`, D10) with
 *     `SET role = EXCLUDED.role`, but only over a NULL role or `mcc`. `seedAssetGroups` fills a
 *     NULL role and never overwrites one, so on a database an earlier seed wrote the twelve keep
 *     `mcc` without this step (plan §2, the `COALESCE` fact). Any other role is an
 *     administrator's and survives every re-seed. This is the one place the seed overwrites a
 *     membership role, and it touches only the stale `mcc` of these twelve rows at this one site.
 *  2. **The members the preset names.** `CR-UPS-1`/`-2` (`ups`), the four rack PDUs (`pdu`) and
 *     `CR-HVAC-1`/`-2` (`crac`) join the same group, `ON CONFLICT DO NOTHING`: a membership an
 *     operator already holds keeps its role. An explicit list, never a pattern: `CR-UPS-OUT-BUS`
 *     holds `UPS` and is a bus, not a UPS unit, so it stays out of the group.
 *  3. **`breaker_trip` on the twelve breakers**, an active `unmapped` catalog row in the shape the
 *     ruled-point catalog gives `breaker_main` (`SIM_BREAKER_TRIP`, no RTU), `ON CONFLICT
 *     (asset_id, point_key) DO NOTHING`, so an operator's own row is never overwritten.
 *  4. **`rating` and `trip_cause`**, from {@link BREAKER_DEMO_NAMEPLATES} (copied from the web's
 *     `CR_BREAKERS`), written only while both `rating` and `trip_cause` are NULL: a rating or a
 *     trip cause an administrator set by hand survives every re-seed, with the rest of that row's
 *     nameplate. A mockup cause of `-` is stored as NULL; the breaker table renders NULL as `-`.
 *  5. **The demo dashboard** {@link BREAKER_DEMO_DASHBOARD_SLUG}, scoped to the `electrical` group,
 *     with one `lv_single_line` mimic and one `breaker_table` under it. No tab: the mimic and the
 *     table bind the dashboard's own group. Each widget is `NOT EXISTS`-guarded by type, so a
 *     re-seed writes neither twice and an operator's move or resize survives. A dashboard that
 *     already holds the slug on another group (or none) is not the seed's: it gets no widget, and
 *     one line says so.
 *
 * **Where it runs (`seed.ts`).** In the ESKOM bracket after `seedRuledPointCatalog`: after
 * `seedAssetGroups` (the group and the twelve memberships) and after `seedPointKeyCatalog` (the
 * `breaker_trip` key and its unit).
 *
 * **Post-conditions.** Every step may correctly write nothing on a re-seed, so each is read back
 * and the call throws on a shortfall: step 1 when a breaker's membership is missing or its role is
 * still NULL or `mcc`, steps 2 to 5 on the counts of {@link VERIFY_SQL} — a write outside the tenant context changes zero rows without raising
 * under FORCE ROW LEVEL SECURITY (`water-plant-demo-seed.ts`).
 */

/** The demo dashboard's slug, unique per `(organization_id, slug)` (migration `0050`). */
export const BREAKER_DEMO_DASHBOARD_SLUG = "sld-demo-rsmoc-wc";

/** The demo dashboard's display name. */
export const BREAKER_DEMO_DASHBOARD_NAME = "RSMOC-WC single line and breakers";

/** The group the demo binds: `seedAssetGroups`' per-site electrical group. */
export const BREAKER_DEMO_GROUP_CODE = "electrical";

/** The mimic widget's config. No `tabKey`: the dashboard has no tabs. */
export const BREAKER_DEMO_MIMIC_CONFIG = { source: "preset", preset: "lv_single_line" } as const;

/** The breaker table's config (`breakerTableConfigSchema` is the empty object). */
export const BREAKER_DEMO_TABLE_CONFIG = {} as const;

/**
 * Each breaker's nameplate rating and demo trip cause, copied from `CR_BREAKERS`
 * (`apps/web/src/components/live-svg/control-room-bindings.ts`), which `packages/db` cannot import.
 * `null` where the mockup shows `-`.
 */
export const BREAKER_DEMO_NAMEPLATES: ReadonlyArray<{
  readonly code: string;
  readonly rating: string;
  readonly tripCause: string | null;
}> = [
  { code: "CR-Q1", rating: "100 A", tripCause: null },
  { code: "CR-Q2", rating: "40 A", tripCause: null },
  { code: "CR-Q3", rating: "40 A", tripCause: null },
  { code: "CR-Q4", rating: "40 A", tripCause: null },
  { code: "CR-Q5", rating: "40 A", tripCause: null },
  { code: "CR-Q6", rating: "16 A", tripCause: null },
  { code: "CR-Q7", rating: "16 A", tripCause: null },
  { code: "CR-Q8", rating: "16 A", tripCause: null },
  { code: "CR-Q9", rating: "16 A", tripCause: "high I^2t" },
  { code: "CR-Q10", rating: "25 A", tripCause: null },
  { code: "CR-Q11", rating: "25 A", tripCause: "manual" },
  { code: "CR-Q12", rating: "10 A", tripCause: null },
];

/** The twelve breakers whose role step 1 forces. */
export const BREAKER_DEMO_BREAKER_CODES: readonly string[] = BREAKER_DEMO_NAMEPLATES.map((row) => row.code);

/** The eight members step 2 adds: the UPS units, the rack PDUs and the CRAC units. */
export const BREAKER_DEMO_ADDED_MEMBER_CODES: readonly string[] = [
  "CR-UPS-1",
  "CR-UPS-2",
  "CR-NET-RACK-PDU-A",
  "CR-NET-RACK-PDU-B",
  "CR-VW-RACK-PDU-A",
  "CR-VW-RACK-PDU-B",
  "CR-HVAC-1",
  "CR-HVAC-2",
];

const GROUP_ID_SQL = `
  SELECT id FROM bms.asset_groups
  WHERE organization_id = $1 AND location_id = $2 AND code = $3
`;

/** The assets of a code list at the location, with the domain `demoRoleForAsset` reads. */
const ASSETS_SQL = `
  SELECT id, code, domain FROM bms.assets
  WHERE organization_id = $1 AND location_id = $2 AND code = ANY($3::varchar[])
  ORDER BY code
`;

/**
 * Step 1 — the breaker role, over a NULL or the stale `mcc` only: see the module docblock. Any
 * other role is an administrator's and survives.
 */
const FORCE_ROLE_SQL = `
  INSERT INTO bms.asset_group_members (asset_group_id, asset_id, role)
  VALUES ($1, $2, $3)
  ON CONFLICT (asset_group_id, asset_id) DO UPDATE
  SET role = EXCLUDED.role
  WHERE asset_group_members.role IS NULL OR asset_group_members.role = 'mcc'
`;

/** Step 1's read-back: the twelve memberships and their roles. */
const BREAKER_ROLES_SQL = `
  SELECT a.code, agm.role
    FROM bms.asset_group_members agm
    JOIN bms.assets a ON a.id = agm.asset_id
   WHERE agm.asset_group_id = $1 AND a.code = ANY($2::varchar[])
   ORDER BY a.code
`;

/** Step 2 — a member the preset names; an existing membership keeps its role. */
const ADD_MEMBER_SQL = `
  INSERT INTO bms.asset_group_members (asset_group_id, asset_id, role)
  VALUES ($1, $2, $3)
  ON CONFLICT (asset_group_id, asset_id) DO NOTHING
`;

/** Step 3 — `breaker_trip`, in the ruled-point catalog's row shape (`ruled-point-catalog-seed.ts`). */
const BREAKER_TRIP_POINTS_SQL = `
  INSERT INTO bms.asset_points
    (organization_id, asset_id, point_key, source_data_key, rtu_id, source_kind, unit, active)
  SELECT $1::uuid, a.id, 'breaker_trip', 'SIM_BREAKER_TRIP', NULL, 'unmapped', pk.unit, true
  FROM bms.assets a
  LEFT JOIN bms.point_keys pk ON pk.code = 'breaker_trip' AND pk.active = true
  WHERE a.organization_id = $1 AND a.location_id = $2 AND a.code = ANY($3::varchar[])
  ON CONFLICT (asset_id, point_key) DO NOTHING
`;

/** Step 4 — one breaker's nameplate, only while both its rating and its trip cause are unset. */
const NAMEPLATE_SQL = `
  UPDATE bms.assets
  SET rating = $4, trip_cause = $5
  WHERE organization_id = $1 AND location_id = $2 AND code = $3 AND rating IS NULL AND trip_cause IS NULL
`;

/** Step 5 — the dashboard, scoped to the group. `DO NOTHING`: the slug is stable. */
const DASHBOARD_INSERT_SQL = `
  INSERT INTO bms.dashboards (organization_id, slug, name, asset_group_id)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (organization_id, slug) DO NOTHING
`;

/** The slug's dashboard and the group it binds: the widget step runs only on the seed's own group. */
const DASHBOARD_ID_SQL = `
  SELECT id, asset_group_id FROM bms.dashboards WHERE organization_id = $1 AND slug = $2
`;

/** One widget of a type per dashboard — `NOT EXISTS`-guarded so a re-seed writes it once. */
const WIDGET_INSERT_SQL = `
  INSERT INTO bms.dashboard_widgets
    (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h, config)
  SELECT $1, $2, $3::varchar, $4, $5, $6, $7, $8::jsonb
  WHERE NOT EXISTS (
    SELECT 1 FROM bms.dashboard_widgets
    WHERE dashboard_id = $2 AND widget_type = $3::varchar
  )
`;

/** The read-back of steps 2 to 5, inside the same tenant bracket. */
const VERIFY_SQL = `
SELECT
  (SELECT count(*)::int FROM bms.asset_group_members agm
     JOIN bms.assets a ON a.id = agm.asset_id
     WHERE agm.asset_group_id = $1 AND a.code = ANY($2::varchar[])) AS added_members,
  (SELECT count(*)::int FROM bms.asset_points ap
     JOIN bms.assets a ON a.id = ap.asset_id
     WHERE a.organization_id = $3 AND a.location_id = $4 AND a.code = ANY($5::varchar[])
       AND ap.point_key = 'breaker_trip') AS trip_points,
  (SELECT count(*)::int FROM bms.assets a
     WHERE a.organization_id = $3 AND a.location_id = $4 AND a.code = ANY($5::varchar[])
       AND (a.rating IS NOT NULL OR a.trip_cause IS NOT NULL)) AS rated,
  (SELECT count(*)::int FROM bms.dashboard_widgets w
     WHERE w.dashboard_id = $6::uuid AND w.widget_type = 'mimic') AS mimics,
  (SELECT count(*)::int FROM bms.dashboard_widgets w
     WHERE w.dashboard_id = $6::uuid AND w.widget_type = 'breaker_table') AS tables
`;

type VerifyRow = { added_members: number; trip_points: number; rated: number; mimics: number; tables: number };

type AssetRow = { id: string; code: string; domain: string };

async function assetsAt(
  pool: pg.Pool,
  organizationId: string,
  locationId: string,
  codes: readonly string[],
): Promise<AssetRow[]> {
  const res = await pool.query<AssetRow>(ASSETS_SQL, [organizationId, locationId, codes]);
  if (res.rows.length !== codes.length) {
    const found = new Set(res.rows.map((row) => row.code));
    throw new Error(
      `seedBreakerDemo: ${res.rows.length} of ${codes.length} assets at RSMOC-WC; missing ` +
        codes.filter((code) => !found.has(code)).join(", "),
    );
  }
  return res.rows;
}

function roleOf(asset: AssetRow): string {
  const role = demoRoleForAsset(asset.code, asset.domain);
  if (role === null) {
    throw new Error(`seedBreakerDemo: demoRoleForAsset gives ${asset.code} (${asset.domain}) no role`);
  }
  return role;
}

/**
 * Seeds the breaker demo at `RSMOC-WC`. `rsmocWcId` is the row `seedEskomLocations` resolved for
 * the identity, or `null` when it wrote none: then nothing is written and one line says so (the
 * `seedSiteControlRoomViews` rule).
 */
export async function seedBreakerDemo(
  pool: pg.Pool,
  organizationId: string,
  rsmocWcId: string | null,
  log: (line: string) => void = (line) => console.error(line),
): Promise<void> {
  if (rsmocWcId === null) {
    log("seedBreakerDemo: no breaker demo written: seedEskomLocations wrote no row for rsmoc-western-cape");
    return;
  }
  const group = await pool.query<{ id: string }>(GROUP_ID_SQL, [organizationId, rsmocWcId, BREAKER_DEMO_GROUP_CODE]);
  const groupId = group.rows[0]?.id;
  if (!groupId) {
    throw new Error(
      `seedBreakerDemo: no '${BREAKER_DEMO_GROUP_CODE}' group at RSMOC-WC — must run after seedAssetGroups`,
    );
  }

  // Step 1 — the breaker roles over a NULL or `mcc`. A skipped row (an administrator's role)
  // changes no row, so the row count says nothing: the twelve roles are read back instead.
  for (const asset of await assetsAt(pool, organizationId, rsmocWcId, BREAKER_DEMO_BREAKER_CODES)) {
    await pool.query(FORCE_ROLE_SQL, [groupId, asset.id, roleOf(asset)]);
  }
  const roles = await pool.query<{ code: string; role: string | null }>(BREAKER_ROLES_SQL, [
    groupId,
    BREAKER_DEMO_BREAKER_CODES,
  ]);
  const stale = roles.rows.filter((row) => row.role === null || row.role === "mcc");
  if (roles.rows.length !== BREAKER_DEMO_BREAKER_CODES.length || stale.length > 0) {
    throw new Error(
      `seedBreakerDemo: ${roles.rows.length} of ${BREAKER_DEMO_BREAKER_CODES.length} breaker memberships read back, ` +
        `${stale.length} still NULL or mcc (${stale.map((row) => row.code).join(", ")}). A FORCE-RLS write can ` +
        "drop rows without raising; check this runs inside the ESKOM tenant bracket.",
    );
  }

  // Step 2 — the members the preset names.
  for (const asset of await assetsAt(pool, organizationId, rsmocWcId, BREAKER_DEMO_ADDED_MEMBER_CODES)) {
    await pool.query(ADD_MEMBER_SQL, [groupId, asset.id, roleOf(asset)]);
  }

  // Step 3 — breaker_trip on the twelve.
  await pool.query(BREAKER_TRIP_POINTS_SQL, [organizationId, rsmocWcId, BREAKER_DEMO_BREAKER_CODES]);

  // Step 4 — nameplates, never over a hand-set rating.
  for (const row of BREAKER_DEMO_NAMEPLATES) {
    await pool.query(NAMEPLATE_SQL, [organizationId, rsmocWcId, row.code, row.rating, row.tripCause]);
  }

  // Step 5 — the dashboard and its two widgets: the diagram, and the table under it.
  await pool.query(DASHBOARD_INSERT_SQL, [
    organizationId,
    BREAKER_DEMO_DASHBOARD_SLUG,
    BREAKER_DEMO_DASHBOARD_NAME,
    groupId,
  ]);
  const dashboard = await pool.query<{ id: string; asset_group_id: string | null }>(DASHBOARD_ID_SQL, [
    organizationId,
    BREAKER_DEMO_DASHBOARD_SLUG,
  ]);
  const dashboardId = dashboard.rows[0]?.id;
  if (!dashboardId) {
    throw new Error(`seedBreakerDemo: dashboard '${BREAKER_DEMO_DASHBOARD_SLUG}' does not exist after insert`);
  }
  // The slug is all `DO NOTHING` matched on. A dashboard holding it on another group (or none) is
  // not the seed's: it gets no widget, and the boot goes on — a throw here would fail every boot.
  const ours = dashboard.rows[0]?.asset_group_id === groupId;
  if (ours) {
    await pool.query(WIDGET_INSERT_SQL, [
      organizationId,
      dashboardId,
      "mimic",
      0,
      0,
      12,
      10,
      JSON.stringify(BREAKER_DEMO_MIMIC_CONFIG),
    ]);
    await pool.query(WIDGET_INSERT_SQL, [
      organizationId,
      dashboardId,
      "breaker_table",
      0,
      10,
      12,
      5,
      JSON.stringify(BREAKER_DEMO_TABLE_CONFIG),
    ]);
  } else {
    log(
      `seedBreakerDemo: no demo widgets written: dashboard '${BREAKER_DEMO_DASHBOARD_SLUG}' binds another group ` +
        `than RSMOC-WC's '${BREAKER_DEMO_GROUP_CODE}'`,
    );
  }

  const check = await pool.query<VerifyRow>(VERIFY_SQL, [
    groupId,
    BREAKER_DEMO_ADDED_MEMBER_CODES,
    organizationId,
    rsmocWcId,
    BREAKER_DEMO_BREAKER_CODES,
    ours ? dashboardId : null,
  ]);
  const row = check.rows[0];
  const want = BREAKER_DEMO_BREAKER_CODES.length;
  const wantMembers = BREAKER_DEMO_ADDED_MEMBER_CODES.length;
  // `rated` counts a breaker whose rating or trip cause is set: step 4 writes neither over a value
  // an operator set by hand, so either one counts, and a write a FORCE-RLS bracket dropped leaves
  // both NULL, which fails. Widgets: at least one of each, as `seedWaterMimicDemo` — an operator
  // may add a second — and none asked of a dashboard the step left alone.
  if (
    !row ||
    row.added_members !== wantMembers ||
    row.trip_points !== want ||
    row.rated !== want ||
    (ours && (row.mimics < 1 || row.tables < 1))
  ) {
    throw new Error(
      `seedBreakerDemo: ${row?.added_members ?? -1} of ${wantMembers} preset members, ` +
        `${row?.trip_points ?? -1} of ${want} breaker_trip points, ${row?.rated ?? -1} of ${want} rated ` +
        `breakers, ${row?.mimics ?? -1} mimic and ${row?.tables ?? -1} breaker_table widget(s) (want at ` +
        "least 1 each). A FORCE-RLS write can drop rows without raising; check this runs inside the " +
        "ESKOM tenant bracket, after seedAssetGroups and seedPointKeyCatalog.",
    );
  }
}
