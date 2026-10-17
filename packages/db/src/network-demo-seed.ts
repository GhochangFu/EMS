import type pg from "pg";

import type { EskomAssetSpec } from "./eskom-assets-seed";

/**
 * `F3.80` PR3 Task 3.1 — the demo assets behind the two ESKOM network mimics (ADR 0101): an HT/LT
 * single-line network and a pump/valve/damper flow network, both at the RSMOC-WC control room
 * (owner ruling 2026-10-15, OQ3 (a)).
 *
 * Fifteen assets, each code prefixed `ND-` and avoiding every substring `demoRoleForAsset` matches,
 * so none takes a role from the catalog and `eskomSmocRoledCodes` does not move. The roles are
 * written per group by `seedNetworkDemo` (Task 3.2). They sit in the ESKOM catalog, spread after
 * `DEMO_WATER_PLANT_ASSETS`, because `seedEskomAssets` precedes `seedEskomLadderRules`, which
 * covers every ESKOM electrical asset (the boot gate's "uncovered electrical" count stays 0).
 *
 * ESKOM only. No PHEWB row is written, because PHEWB is the real pilot.
 */

/**
 * The site name, the same string as `CONTROL_ROOM_SITE_NAME` in `eskom-assets-seed.ts`. Restated,
 * not imported: that file imports this one, and a value import would be a cycle. The spec holds
 * the two equal.
 */
const NETWORK_DEMO_SITE_NAME = "RSMOC Western Cape";

function asset(code: string, name: string, domain: string): EskomAssetSpec {
  return { code, name, siteName: NETWORK_DEMO_SITE_NAME, domain };
}

export const NETWORK_DEMO_ASSETS: readonly EskomAssetSpec[] = [
  // HT/LT network — branch A binds fully, branch B binds its two switching units only (OQ1 (a)).
  asset("ND-HT-GRID-CB", "Network Demo HT Grid Incomer Breaker", "electrical"),
  asset("ND-HT-COUPLER", "Network Demo HT Bus Coupler", "electrical"),
  asset("ND-DG-1", "Network Demo Diesel Generator 1", "electrical"),
  asset("ND-HT-DG-CB", "Network Demo HT DG Breaker", "electrical"),
  asset("ND-HT-OUT-CB", "Network Demo HT Outgoing Breaker A", "electrical"),
  asset("ND-TR-A", "Network Demo Transformer A", "electrical"),
  asset("ND-LT-A", "Network Demo LT Panel A", "electrical"),
  asset("ND-LT-A-F1", "Network Demo LT A Feeder 1", "electrical"),
  asset("ND-LT-A-F2", "Network Demo LT A Feeder 2", "electrical"),
  asset("ND-HT-ISO-B", "Network Demo HT Isolator B", "electrical"),
  asset("ND-LT-B-F1", "Network Demo LT B Mains Feeder 1", "electrical"),
  // Flow network — one drawing, water then air (OQ5 (a)); one roled isolation valve (OQ6 (a)).
  asset("ND-FL-PUMP", "Network Demo Pump", "water"),
  asset("ND-FL-ISO-V1", "Network Demo Isolation Valve 1", "water"),
  asset("ND-FL-CV", "Network Demo Control Valve", "water"),
  asset("ND-FL-DAMPER", "Network Demo Damper", "hvac"),
];

// ───────────────────────────────────────────────────────────────── seedNetworkDemo (Task 3.2)

/**
 * `F3.80` PR3 Task 3.2 (ADR 0101 d15, d16) — the two ESKOM network demos at RSMOC-WC.
 *
 * **What this seeds, at the row `seedEskomLocations` resolved for `RSMOC-WC` only** (owner ruling
 * 17, the `seedBreakerDemo` rule). Five steps, each guarded so a re-seed writes nothing twice:
 *
 *  1. **Two groups**, {@link NETWORK_DEMO_NETWORKS}' `groupCode`s, `ON CONFLICT (location_id, code)
 *     DO NOTHING`: a name an operator changed survives. No `domain`: the HT/LT group would be a
 *     second `electrical` group at the site for the site-layout planner to choose between, and the
 *     flow group holds water and HVAC members.
 *  2. **Fifteen memberships with roles**, `COALESCE(role, EXCLUDED.role)` (the `seedAssetGroups`
 *     idiom): a role an administrator set survives. Branch B of the HT/LT network binds only its
 *     two switching units (owner ruling OQ1 (a)); `tr_b` and `lt_b` are drawn passive.
 *  3. **The state points** of {@link NETWORK_DEMO_STATE_POINTS}, by asset code, in the row shape of
 *     `seedBreakerDemo`'s `breaker_trip` (`unmapped`, no RTU, `SIM_<KEY>`), `ON CONFLICT (asset_id,
 *     point_key) DO NOTHING`. A unit has state points only through such rows
 *     (`mimic-nodes.service.ts`), and only for a key with `bms.point_key_states` rows: `dg_on_load`
 *     has none, so it is telemetry only (OQ4 note).
 *  4. **Two layouts**, `ON CONFLICT (organization_id, slug) DO NOTHING`. The nodes and pipes are
 *     written **only when the layout row was inserted on this pass**: a node an operator moved,
 *     added or deleted, and the version the editor bumped, survive every re-seed. Every breaker
 *     switches by its symbol, so `is_switching` is false throughout the HT/LT layout; the flow
 *     layout's valves and damper carry the flag (ADR 0101 d4). Every node key matches
 *     `MIMIC_LAYOUT_NODE_KEY`, so the layout's own `PUT` body parses (`F4.263`); migration `0112`
 *     renamed the hyphenated keys of layouts seeded before that.
 *  5. **Two dashboards**, each scoped to its group, with one `mimic` widget bound to its layout; the
 *     HT/LT dashboard also has a `breaker_table` (plan §3: the one place the tripped feeder is a
 *     row). Widgets are `NOT EXISTS`-guarded by type, and a dashboard holding the slug on another
 *     group gets none (the `seedBreakerDemo` `ours` rule).
 *
 * **Where it runs (`seed.ts`).** In the ESKOM bracket after `seedBreakerDemo`: after
 * `seedEskomAssets` (the fifteen assets), `seedAssetGroups` (their locations), `seedPointKeyCatalog`
 * and the `0109` roles; before `seedAssetTemplateHealth`, so each new role template declares the
 * state points on the first boot as on every later one.
 *
 * **Post-conditions.** Each step may correctly write nothing on a re-seed, so {@link VERIFY_SQL}
 * reads all five back and the call throws on a shortfall — a write outside the tenant context
 * changes zero rows without raising under FORCE ROW LEVEL SECURITY.
 *
 * ESKOM only. No PHEWB row: PHEWB is the real pilot.
 */

/** One drawn unit: `[key, symbol, label, roleCode, isSource, isSwitching, fanOut, x, y]`. */
export type NetworkDemoNode = readonly [
  key: string,
  symbol: string,
  label: string,
  roleCode: string | null,
  isSource: boolean,
  isSwitching: boolean,
  fanOut: boolean,
  x: number,
  y: number,
];

export type NetworkDemoNetwork = {
  readonly groupCode: string;
  readonly groupName: string;
  /** The layout's and the dashboard's slug. */
  readonly slug: string;
  /** The layout's and the dashboard's name. */
  readonly name: string;
  readonly canvasW: number;
  readonly canvasH: number;
  readonly symbolLibraries: readonly string[];
  /** `[assetCode, role]`. */
  readonly members: ReadonlyArray<readonly [string, string]>;
  readonly nodes: readonly NetworkDemoNode[];
  /** `[fromKey, toKey]`. */
  readonly pipes: ReadonlyArray<readonly [string, string]>;
  readonly breakerTable: boolean;
};

/**
 * A unit's box, in grid cells: the editor's default unit box
 * (`MIMIC_EDITOR_DEFAULT_BOX`), and `z` the editor's unit drawing order
 * (`MIMIC_EDITOR_Z.unit`). Exported so the seed-parse spec sends the box the
 * seed writes, not a copy of it.
 */
export const NETWORK_DEMO_UNIT_BOX = { w: 20, h: 25, z: 10 } as const;
const UNIT_W = NETWORK_DEMO_UNIT_BOX.w;
const UNIT_H = NETWORK_DEMO_UNIT_BOX.h;
const UNIT_Z = NETWORK_DEMO_UNIT_BOX.z;

const T = true;
const F = false;

export const NETWORK_DEMO_NETWORKS: readonly NetworkDemoNetwork[] = [
  {
    groupCode: "demo-ht-lt-network",
    groupName: "HT/LT network demo",
    slug: "network-demo-ht-lt",
    name: "RSMOC-WC HT/LT network",
    canvasW: 240,
    canvasH: 160,
    symbolLibraries: ["core"],
    members: [
      ["ND-HT-GRID-CB", "ht-incomer-breaker"],
      ["ND-HT-COUPLER", "bus-coupler"],
      ["ND-DG-1", "dg-set"],
      ["ND-HT-DG-CB", "dg-breaker"],
      ["ND-HT-OUT-CB", "ht-outgoing-breaker"],
      ["ND-TR-A", "transformer"],
      ["ND-LT-A", "lt-panel"],
      ["ND-LT-A-F1", "load-feeder-breaker"],
      ["ND-LT-A-F2", "load-feeder-breaker"],
      ["ND-HT-ISO-B", "isolator"],
      ["ND-LT-B-F1", "mains-feeder-breaker"],
    ],
    nodes: [
      ["grid_cb", "breaker", "Grid incomer", "ht-incomer-breaker", T, F, F, 20, 0],
      ["dg_cb", "breaker", "DG breaker", "dg-breaker", F, F, F, 170, 0],
      ["dg", "generator", "DG set", "dg-set", T, F, F, 210, 0],
      ["bus_a", "switchboard", "HT bus A", null, F, F, F, 20, 27],
      ["coupler", "breaker", "Bus coupler", "bus-coupler", F, F, F, 95, 27],
      ["bus_b", "switchboard", "HT bus B", null, F, F, F, 170, 27],
      ["out_cb_a", "breaker", "Outgoing A", "ht-outgoing-breaker", F, F, F, 20, 54],
      ["iso_b", "breaker", "Isolator B", "isolator", F, F, F, 170, 54],
      ["tr_a", "transformer", "Transformer A", "transformer", F, F, F, 20, 81],
      ["tr_b", "transformer", "Transformer B", null, F, F, F, 170, 81],
      ["lt_a", "switchboard", "LT panel A", "lt-panel", F, F, F, 20, 108],
      ["lt_b", "switchboard", "LT panel B", null, F, F, F, 170, 108],
      ["fdr_a", "breaker", "LT A feeders", "load-feeder-breaker", F, F, T, 20, 135],
      ["fdr_b", "breaker", "LT B mains feeder", "mains-feeder-breaker", F, F, F, 170, 135],
    ],
    pipes: [
      ["grid_cb", "bus_a"],
      ["bus_a", "coupler"],
      ["coupler", "bus_b"],
      ["bus_b", "coupler"],
      ["coupler", "bus_a"],
      ["dg", "dg_cb"],
      ["dg_cb", "bus_b"],
      ["bus_a", "out_cb_a"],
      ["out_cb_a", "tr_a"],
      ["tr_a", "lt_a"],
      ["lt_a", "fdr_a"],
      ["bus_b", "iso_b"],
      ["iso_b", "tr_b"],
      ["tr_b", "lt_b"],
      ["lt_b", "fdr_b"],
    ],
    breakerTable: true,
  },
  {
    groupCode: "demo-flow-network",
    groupName: "Flow network demo",
    slug: "network-demo-flow",
    name: "RSMOC-WC flow network",
    canvasW: 190,
    canvasH: 60,
    symbolLibraries: ["core", "qet"],
    members: [
      ["ND-FL-PUMP", "pump"],
      ["ND-FL-ISO-V1", "isolation-valve"],
      ["ND-FL-CV", "control-valve"],
      ["ND-FL-DAMPER", "damper"],
    ],
    nodes: [
      ["pump", "pump", "Pump", "pump", T, F, F, 10, 0],
      ["header", "tank", "Header", null, F, F, F, 40, 0],
      ["iso_v1", "valve", "Isolation valve", "isolation-valve", F, T, F, 70, 0],
      ["tank_a", "tank", "Tank A", null, F, F, F, 100, 0],
      ["cv", "valve", "Control valve", "control-valve", F, T, F, 70, 32],
      ["ahu", "ahu", "AHU", null, F, F, F, 100, 32],
      ["damper", "qet:air-damper", "Damper", "damper", F, T, F, 130, 32],
      ["zone", "discharge", "Zone", null, F, F, F, 160, 32],
    ],
    pipes: [
      ["pump", "header"],
      ["header", "iso_v1"],
      ["iso_v1", "tank_a"],
      ["header", "cv"],
      ["cv", "ahu"],
      ["ahu", "damper"],
      ["damper", "zone"],
    ],
    breakerTable: false,
  },
];

/** The eight breakers, by code: each carries `breaker_main` and `breaker_trip`. */
const NETWORK_DEMO_BREAKER_CODES = [
  "ND-HT-GRID-CB",
  "ND-HT-COUPLER",
  "ND-HT-DG-CB",
  "ND-HT-OUT-CB",
  "ND-LT-A-F1",
  "ND-LT-A-F2",
  "ND-HT-ISO-B",
  "ND-LT-B-F1",
] as const;

/**
 * `[assetCode, pointKey]` — twenty-one points, keyed by code. `dg_on_load` and `pump_status` have no
 * state rows, so they are telemetry only; `pump_status` gives the flow layout's source unit a
 * registered point the sim holds at 1.
 */
export const NETWORK_DEMO_STATE_POINTS: ReadonlyArray<readonly [string, string]> = [
  ...NETWORK_DEMO_BREAKER_CODES.flatMap((code) => [
    [code, "breaker_main"] as const,
    [code, "breaker_trip"] as const,
  ]),
  ["ND-DG-1", "dg_on_load"],
  ["ND-FL-ISO-V1", "valve_open"],
  ["ND-FL-CV", "valve_open"],
  ["ND-FL-DAMPER", "damper_open"],
  ["ND-FL-PUMP", "pump_status"],
];

/** The widget configs: `mimicLayoutConfigSchema` and the empty `breakerTableConfigSchema`. */
function mimicConfigOf(layoutId: string): { source: "layout"; layoutId: string } {
  return { source: "layout", layoutId };
}

const ASSETS_SQL = `
  SELECT code FROM bms.assets
  WHERE organization_id = $1 AND location_id = $2 AND code = ANY($3::varchar[])
`;

/** Step 1 — `DO NOTHING`: a renamed group keeps its name. */
const GROUP_INSERT_SQL = `
  INSERT INTO bms.asset_groups (location_id, code, name, description, organization_id)
  VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (location_id, code) DO NOTHING
`;

const GROUP_ID_SQL = `
  SELECT id FROM bms.asset_groups
  WHERE organization_id = $1 AND location_id = $2 AND code = $3
`;

/** Step 2 — one membership by code; an existing role wins (`COALESCE`). */
const MEMBER_UPSERT_SQL = `
  INSERT INTO bms.asset_group_members (asset_group_id, asset_id, role)
  SELECT $1, a.id, $5
  FROM bms.assets a
  WHERE a.organization_id = $2 AND a.location_id = $3 AND a.code = $4
  ON CONFLICT (asset_group_id, asset_id) DO UPDATE
  SET role = COALESCE(bms.asset_group_members.role, EXCLUDED.role)
`;

/** Step 3 — the state points, in `seedBreakerDemo`'s `breaker_trip` row shape. */
const STATE_POINTS_SQL = `
  INSERT INTO bms.asset_points
    (organization_id, asset_id, point_key, source_data_key, rtu_id, source_kind, unit, active)
  SELECT $1::uuid, a.id, p.point_key, 'SIM_' || upper(p.point_key), NULL, 'unmapped', pk.unit, true
  FROM unnest($3::varchar[], $4::varchar[]) AS p(code, point_key)
  JOIN bms.assets a ON a.organization_id = $1 AND a.location_id = $2 AND a.code = p.code
  LEFT JOIN bms.point_keys pk ON pk.code = p.point_key AND pk.active = true
  ON CONFLICT (asset_id, point_key) DO NOTHING
`;

/** Step 4 — the layout row. `RETURNING` answers a row only when this pass inserted it. */
const LAYOUT_INSERT_SQL = `
  INSERT INTO bms.mimic_layouts (organization_id, name, slug, canvas_w, canvas_h, symbol_libraries, created_by)
  VALUES ($1, $2, $3, $4, $5, $6::varchar[], NULL)
  ON CONFLICT (organization_id, slug) DO NOTHING
  RETURNING id
`;

const LAYOUT_ID_SQL = `
  SELECT id FROM bms.mimic_layouts WHERE organization_id = $1 AND slug = $2
`;

/** Step 4 — every node of a just-inserted layout, as units. */
const NODES_INSERT_SQL = `
  INSERT INTO bms.mimic_layout_nodes
    (organization_id, layout_id, key, kind, symbol, label, role_code, x, y, w, h, z, is_source, is_switching, fan_out)
  SELECT $1, $2, n.key, 'unit', n.symbol, n.label, n.role_code, n.x, n.y, $12, $13, $14,
         n.is_source, n.is_switching, n.fan_out
  FROM unnest($3::varchar[], $4::varchar[], $5::varchar[], $6::varchar[], $7::int[], $8::int[],
              $9::boolean[], $10::boolean[], $11::boolean[])
    AS n(key, symbol, label, role_code, x, y, is_source, is_switching, fan_out)
`;

/** Step 4 — every pipe of a just-inserted layout, its ends found by key. */
const PIPES_INSERT_SQL = `
  INSERT INTO bms.mimic_layout_pipes (organization_id, layout_id, from_node_id, to_node_id)
  SELECT $1, $2, f.id, t.id
  FROM unnest($3::varchar[], $4::varchar[]) AS p(from_key, to_key)
  JOIN bms.mimic_layout_nodes f ON f.layout_id = $2 AND f.key = p.from_key
  JOIN bms.mimic_layout_nodes t ON t.layout_id = $2 AND t.key = p.to_key
`;

/** Step 4's read-back of a just-inserted layout. */
const LAYOUT_COUNTS_SQL = `
  SELECT
    (SELECT count(*)::int FROM bms.mimic_layout_nodes WHERE layout_id = $1) AS nodes,
    (SELECT count(*)::int FROM bms.mimic_layout_pipes WHERE layout_id = $1) AS pipes
`;

/** Step 5 — the dashboard, scoped to the group. `DO NOTHING`: the slug is stable. */
const DASHBOARD_INSERT_SQL = `
  INSERT INTO bms.dashboards (organization_id, slug, name, asset_group_id)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (organization_id, slug) DO NOTHING
`;

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

/**
 * The read-back of all five steps, inside the same tenant bracket. `roled` counts the expected
 * memberships that carry any role (an administrator's counts), `points` the expected state points;
 * `mimic_dashboards`/`table_dashboards` count the seed's own dashboards holding the widget.
 */
const VERIFY_SQL = `
SELECT
  (SELECT count(*)::int FROM bms.asset_groups
     WHERE organization_id = $1 AND location_id = $2 AND code = ANY($3::varchar[])) AS groups,
  (SELECT count(*)::int
     FROM unnest($4::varchar[], $5::varchar[]) AS m(group_code, code)
     JOIN bms.asset_groups g ON g.organization_id = $1 AND g.location_id = $2 AND g.code = m.group_code
     JOIN bms.assets a ON a.organization_id = $1 AND a.location_id = $2 AND a.code = m.code
     JOIN bms.asset_group_members agm ON agm.asset_group_id = g.id AND agm.asset_id = a.id
    WHERE agm.role IS NOT NULL) AS roled,
  (SELECT count(*)::int
     FROM unnest($6::varchar[], $7::varchar[]) AS p(code, point_key)
     JOIN bms.assets a ON a.organization_id = $1 AND a.location_id = $2 AND a.code = p.code
     JOIN bms.asset_points ap ON ap.asset_id = a.id AND ap.point_key = p.point_key) AS points,
  (SELECT count(*)::int FROM bms.mimic_layouts
     WHERE organization_id = $1 AND slug = ANY($8::varchar[])) AS layouts,
  (SELECT count(*)::int FROM unnest($9::uuid[]) AS d(id)
    WHERE EXISTS (SELECT 1 FROM bms.dashboard_widgets w
                   WHERE w.dashboard_id = d.id AND w.widget_type = 'mimic')) AS mimic_dashboards,
  (SELECT count(*)::int FROM unnest($10::uuid[]) AS d(id)
    WHERE EXISTS (SELECT 1 FROM bms.dashboard_widgets w
                   WHERE w.dashboard_id = d.id AND w.widget_type = 'breaker_table')) AS table_dashboards
`;

type VerifyRow = {
  groups: number;
  roled: number;
  points: number;
  layouts: number;
  mimic_dashboards: number;
  table_dashboards: number;
};

const RLS_HINT =
  "A FORCE-RLS write can drop rows without raising; check this runs inside the ESKOM tenant " +
  "bracket, after seedEskomAssets, seedAssetGroups and seedPointKeyCatalog.";

/** Step 4 for one network: the layout id. Nodes and pipes only on a layout this pass inserted. */
async function seedLayout(pool: pg.Pool, organizationId: string, network: NetworkDemoNetwork): Promise<string> {
  const inserted = await pool.query<{ id: string }>(LAYOUT_INSERT_SQL, [
    organizationId,
    network.name,
    network.slug,
    network.canvasW,
    network.canvasH,
    network.symbolLibraries,
  ]);
  const insertedId = inserted.rows[0]?.id;
  if (!insertedId) {
    // The layout was here before this pass: its nodes and pipes are the operator's.
    const existing = await pool.query<{ id: string }>(LAYOUT_ID_SQL, [organizationId, network.slug]);
    const id = existing.rows[0]?.id;
    if (!id) throw new Error(`seedNetworkDemo: layout '${network.slug}' does not exist after insert. ${RLS_HINT}`);
    return id;
  }
  const column = <V>(pick: (node: NetworkDemoNode) => V): V[] => network.nodes.map(pick);
  await pool.query(NODES_INSERT_SQL, [
    organizationId,
    insertedId,
    column((n) => n[0]),
    column((n) => n[1]),
    column((n) => n[2]),
    column((n) => n[3]),
    column((n) => n[7]),
    column((n) => n[8]),
    column((n) => n[4]),
    column((n) => n[5]),
    column((n) => n[6]),
    UNIT_W,
    UNIT_H,
    UNIT_Z,
  ]);
  await pool.query(PIPES_INSERT_SQL, [
    organizationId,
    insertedId,
    network.pipes.map((pipe) => pipe[0]),
    network.pipes.map((pipe) => pipe[1]),
  ]);
  const counts = await pool.query<{ nodes: number; pipes: number }>(LAYOUT_COUNTS_SQL, [insertedId]);
  const row = counts.rows[0];
  if (!row || row.nodes !== network.nodes.length || row.pipes !== network.pipes.length) {
    throw new Error(
      `seedNetworkDemo: layout '${network.slug}' holds ${row?.nodes ?? -1} of ${network.nodes.length} nodes ` +
        `and ${row?.pipes ?? -1} of ${network.pipes.length} pipes. ${RLS_HINT}`,
    );
  }
  return insertedId;
}

/** Step 5 for one network: the dashboard id when the slug's dashboard is the seed's, else null. */
async function seedDashboard(
  pool: pg.Pool,
  organizationId: string,
  network: NetworkDemoNetwork,
  groupId: string,
  layoutId: string,
  log: (line: string) => void,
): Promise<string | null> {
  await pool.query(DASHBOARD_INSERT_SQL, [organizationId, network.slug, network.name, groupId]);
  const dashboard = await pool.query<{ id: string; asset_group_id: string | null }>(DASHBOARD_ID_SQL, [
    organizationId,
    network.slug,
  ]);
  const found = dashboard.rows[0];
  if (!found) throw new Error(`seedNetworkDemo: dashboard '${network.slug}' does not exist after insert. ${RLS_HINT}`);
  if (found.asset_group_id !== groupId) {
    log(
      `seedNetworkDemo: no demo widgets written: dashboard '${network.slug}' binds another group than ` +
        `RSMOC-WC's '${network.groupCode}'`,
    );
    return null;
  }
  await pool.query(WIDGET_INSERT_SQL, [
    organizationId,
    found.id,
    "mimic",
    0,
    0,
    12,
    10,
    JSON.stringify(mimicConfigOf(layoutId)),
  ]);
  if (network.breakerTable) {
    await pool.query(WIDGET_INSERT_SQL, [organizationId, found.id, "breaker_table", 0, 10, 12, 5, JSON.stringify({})]);
  }
  return found.id;
}

/**
 * Seeds the two network demos at `RSMOC-WC`. `rsmocWcId` is the row `seedEskomLocations` resolved
 * for the identity, or `null` when it wrote none: then nothing is written and one line says so.
 */
export async function seedNetworkDemo(
  pool: pg.Pool,
  organizationId: string,
  rsmocWcId: string | null,
  log: (line: string) => void = (line) => console.error(line),
): Promise<void> {
  if (rsmocWcId === null) {
    log("seedNetworkDemo: no network demo written: seedEskomLocations wrote no row for rsmoc-western-cape");
    return;
  }
  const codes = [...new Set(NETWORK_DEMO_NETWORKS.flatMap((network) => network.members.map((m) => m[0])))];
  const present = await pool.query<{ code: string }>(ASSETS_SQL, [organizationId, rsmocWcId, codes]);
  if (present.rows.length !== codes.length) {
    const found = new Set(present.rows.map((row) => row.code));
    throw new Error(
      `seedNetworkDemo: ${present.rows.length} of ${codes.length} assets at RSMOC-WC; missing ` +
        `${codes.filter((code) => !found.has(code)).join(", ")}. ${RLS_HINT}`,
    );
  }

  const ourDashboards: string[] = [];
  const ourTableDashboards: string[] = [];
  for (const network of NETWORK_DEMO_NETWORKS) {
    // Step 1 — the group.
    await pool.query(GROUP_INSERT_SQL, [
      rsmocWcId,
      network.groupCode,
      network.groupName,
      `F3.80 demo (ADR 0101): the ${network.name} mimic's members`,
      organizationId,
    ]);
    const group = await pool.query<{ id: string }>(GROUP_ID_SQL, [organizationId, rsmocWcId, network.groupCode]);
    const groupId = group.rows[0]?.id;
    if (!groupId) throw new Error(`seedNetworkDemo: group '${network.groupCode}' does not exist after insert. ${RLS_HINT}`);

    // Step 2 — the memberships and their roles.
    for (const [code, role] of network.members) {
      await pool.query(MEMBER_UPSERT_SQL, [groupId, organizationId, rsmocWcId, code, role]);
    }

    // Step 4 — the layout; step 5 — its dashboard.
    const layoutId = await seedLayout(pool, organizationId, network);
    const dashboardId = await seedDashboard(pool, organizationId, network, groupId, layoutId, log);
    if (dashboardId !== null) {
      ourDashboards.push(dashboardId);
      if (network.breakerTable) ourTableDashboards.push(dashboardId);
    }
  }

  // Step 3 — the state points, by code.
  await pool.query(STATE_POINTS_SQL, [
    organizationId,
    rsmocWcId,
    NETWORK_DEMO_STATE_POINTS.map((p) => p[0]),
    NETWORK_DEMO_STATE_POINTS.map((p) => p[1]),
  ]);

  const memberPairs = NETWORK_DEMO_NETWORKS.flatMap((network) =>
    network.members.map((member) => [network.groupCode, member[0]] as const),
  );
  const check = await pool.query<VerifyRow>(VERIFY_SQL, [
    organizationId,
    rsmocWcId,
    NETWORK_DEMO_NETWORKS.map((network) => network.groupCode),
    memberPairs.map((pair) => pair[0]),
    memberPairs.map((pair) => pair[1]),
    NETWORK_DEMO_STATE_POINTS.map((p) => p[0]),
    NETWORK_DEMO_STATE_POINTS.map((p) => p[1]),
    NETWORK_DEMO_NETWORKS.map((network) => network.slug),
    ourDashboards,
    ourTableDashboards,
  ]);
  const row = check.rows[0];
  const want = {
    groups: NETWORK_DEMO_NETWORKS.length,
    roled: memberPairs.length,
    points: NETWORK_DEMO_STATE_POINTS.length,
    layouts: NETWORK_DEMO_NETWORKS.length,
    mimic_dashboards: ourDashboards.length,
    table_dashboards: ourTableDashboards.length,
  };
  const short = (Object.keys(want) as Array<keyof VerifyRow>).filter((key) => row?.[key] !== want[key]);
  if (short.length > 0) {
    throw new Error(
      `seedNetworkDemo: read back ${short.map((key) => `${key} ${row?.[key] ?? -1} of ${want[key]}`).join(", ")}. ${RLS_HINT}`,
    );
  }
}
