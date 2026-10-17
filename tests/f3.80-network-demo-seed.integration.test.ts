import { createRequire } from "node:module";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as Shared from "../packages/shared/dist/index.js";
import type * as NetworkDemoSeed from "../packages/db/dist/network-demo-seed.js";
import type * as SeedTenant from "../packages/db/dist/seed-tenant.js";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

// Loaded from `packages/db/dist` through `createRequire`, for the reason
// `tests/f4.129-ladder-rule-code-bound.integration.test.ts` gives. After a source edit, run
// `pnpm --filter @bms/db build` before this suite, or it runs the last build.
const require_ = createRequire(import.meta.url);
const { seedNetworkDemo } = require_("../packages/db/dist/network-demo-seed.js") as typeof NetworkDemoSeed;
const { createSeedPool } = require_("../packages/db/dist/seed-tenant.js") as typeof SeedTenant;
// The walk, from `packages/shared/dist` the same way (rebuild `@bms/shared` after a source edit).
const { energiseGraph, isSwitchingSymbol, mimicPipeKey } = require_("../packages/shared/dist/index.js") as typeof Shared;
type SwitchState = Shared.SwitchState;

/**
 * The resolver, from `apps/api/dist` (`pnpm --filter api build` first locally), required inside
 * the case for the reason `tests/f3.74-breaker-demo-seed.integration.test.ts` gives. Only the
 * fields these cases read are restated.
 */
interface NodesAnswer {
  readonly widgets: ReadonlyArray<{
    readonly source: string;
    readonly nodes: ReadonlyArray<{
      readonly key: string;
      readonly statePoints: ReadonlyArray<{ readonly pointKey: string }>;
    }>;
  }>;
  readonly stateMaps: ReadonlyArray<{
    readonly pointKey: string;
    readonly states: ReadonlyArray<{ readonly value: number; readonly label: string; readonly tone: string }>;
  }>;
}
interface MimicNodesReader {
  read(organizationId: string, dashboardId: string, readable: readonly string[] | null, nowMs: number): Promise<NodesAnswer>;
}
type MimicNodesServiceModule = {
  MimicNodesService: new (fleetDb: unknown, pool: unknown, accessControl: unknown) => MimicNodesReader;
};

/**
 * `F3.80` PR3 Task 3.2 (ADR 0101 d15, d16) — the ESKOM HT/LT and flow network demo at RSMOC-WC.
 *
 * **After a full `pnpm db:seed`**, the read cases check what the seed left, on a `bms_fleet` probe
 * pool. **Every changing case is one `BEGIN` … `ROLLBACK`** on the seed pool's one connection, in
 * ESKOM's tenant context as `bms_owner`. Every expectation below is a literal from plan §7 step 4,
 * never the seed module's own tables.
 */

const ownerUrl = requireIntegrationDb({
  item: "F3.80",
  label: "the network demo seed",
  because:
    "that the two network layouts, their memberships, state points and dashboards are written once, " +
    "survive an operator's edit and stay out of PHEWB are database behaviours under row-level security.",
  connection: "owner",
});

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type SeedPool = ReturnType<typeof createSeedPool>;
type Queryable = Pick<SeedPool, "query">;

const HT_LT = "network-demo-ht-lt";
const FLOW = "network-demo-flow";

/** `key symbol role is_source is_switching fan_out`, sorted by key. */
const HT_LT_NODES = [
  "bus_a switchboard - F F F",
  "bus_b switchboard - F F F",
  "coupler breaker bus-coupler F F F",
  "dg generator dg-set T F F",
  "dg_cb breaker dg-breaker F F F",
  "fdr_a breaker load-feeder-breaker F F T",
  "fdr_b breaker mains-feeder-breaker F F F",
  "grid_cb breaker ht-incomer-breaker T F F",
  "iso_b breaker isolator F F F",
  "lt_a switchboard lt-panel F F F",
  "lt_b switchboard - F F F",
  "out_cb_a breaker ht-outgoing-breaker F F F",
  "tr_a transformer transformer F F F",
  "tr_b transformer - F F F",
];

const FLOW_NODES = [
  "ahu ahu - F F F",
  "cv valve control-valve F T F",
  "damper qet:air-damper damper F T F",
  "header tank - F F F",
  "iso_v1 valve isolation-valve F T F",
  "pump pump pump T F F",
  "tank_a tank - F F F",
  "zone discharge - F F F",
];

const HT_LT_PIPES = [
  "grid_cb->bus_a",
  "bus_a->coupler",
  "coupler->bus_b",
  "bus_b->coupler",
  "coupler->bus_a",
  "dg->dg_cb",
  "dg_cb->bus_b",
  "bus_a->out_cb_a",
  "out_cb_a->tr_a",
  "tr_a->lt_a",
  "lt_a->fdr_a",
  "bus_b->iso_b",
  "iso_b->tr_b",
  "tr_b->lt_b",
  "lt_b->fdr_b",
];

const FLOW_PIPES = [
  "pump->header",
  "header->iso_v1",
  "iso_v1->tank_a",
  "header->cv",
  "cv->ahu",
  "ahu->damper",
  "damper->zone",
];

/** `group:code=role`. Fifteen memberships. */
const MEMBERSHIPS = [
  "demo-flow-network:ND-FL-CV=control-valve",
  "demo-flow-network:ND-FL-DAMPER=damper",
  "demo-flow-network:ND-FL-ISO-V1=isolation-valve",
  "demo-flow-network:ND-FL-PUMP=pump",
  "demo-ht-lt-network:ND-DG-1=dg-set",
  "demo-ht-lt-network:ND-HT-COUPLER=bus-coupler",
  "demo-ht-lt-network:ND-HT-DG-CB=dg-breaker",
  "demo-ht-lt-network:ND-HT-GRID-CB=ht-incomer-breaker",
  "demo-ht-lt-network:ND-HT-ISO-B=isolator",
  "demo-ht-lt-network:ND-HT-OUT-CB=ht-outgoing-breaker",
  "demo-ht-lt-network:ND-LT-A=lt-panel",
  "demo-ht-lt-network:ND-LT-A-F1=load-feeder-breaker",
  "demo-ht-lt-network:ND-LT-A-F2=load-feeder-breaker",
  "demo-ht-lt-network:ND-LT-B-F1=mains-feeder-breaker",
  "demo-ht-lt-network:ND-TR-A=transformer",
];

const BREAKERS = [
  "ND-HT-GRID-CB",
  "ND-HT-COUPLER",
  "ND-HT-DG-CB",
  "ND-HT-OUT-CB",
  "ND-LT-A-F1",
  "ND-LT-A-F2",
  "ND-HT-ISO-B",
  "ND-LT-B-F1",
];

/** `code=point_key`, sorted: eight breakers × two keys, then the DG, the two valves, the damper, the pump. */
const STATE_POINTS = [
  ...BREAKERS.flatMap((code) => [`${code}=breaker_main`, `${code}=breaker_trip`]),
  "ND-DG-1=dg_on_load",
  "ND-FL-ISO-V1=valve_open",
  "ND-FL-CV=valve_open",
  "ND-FL-DAMPER=damper_open",
  "ND-FL-PUMP=pump_status",
].sort();

/**
 * Not the network seed's: `seedRuledPointCatalog` gives every ESKOM electrical asset the ladder
 * rules' `breaker_main` row, so the three passive electrical members carry one too. None of the
 * three switches (generator, transformer, switchboard symbols, `is_switching` false), so the walk
 * never reads it. Listed so the case below stays exact.
 */
const RULED_BREAKER_MAIN = ["ND-DG-1=breaker_main", "ND-LT-A=breaker_main", "ND-TR-A=breaker_main"];

const ALL_CODES = [...new Set(MEMBERSHIPS.map((row) => row.split(":")[1]!.split("=")[0]!))];

const silent = (): void => undefined;

describe.skipIf(!ownerUrl)("F3.80 Task 3.2 — the network demo seed at RSMOC-WC", { timeout: 60_000 }, () => {
  let probePool: IntegrationPool | undefined;
  let seedPool: SeedPool | undefined;
  let eskomOrgId = "";
  let rsmocWcId = "";

  beforeAll(async () => {
    const url = ownerUrl as string;
    probePool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "fleet", process.env), "F3.80");
    seedPool = createSeedPool(url);
    const role = await seedPool.query<{ current_user: string }>("SELECT current_user");
    if (role.rows[0]?.current_user !== "bms_owner") throw new Error("the seed pool must run as bms_owner");
    const org = await probePool.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code = 'ESKOM'`);
    eskomOrgId = org.rows[0]?.id ?? "";
    const loc = await probePool.query<{ id: string }>(
      `SELECT id FROM bms.locations WHERE meta->>'seedKey' = 'rsmoc-western-cape'`,
    );
    rsmocWcId = loc.rows[0]?.id ?? "";
    if (eskomOrgId === "" || rsmocWcId === "") throw new Error("run pnpm db:seed first");
  }, 60_000);

  afterAll(async () => {
    await seedPool?.end();
    await probePool?.end();
  }, 60_000);

  async function inTransaction(body: (pool: SeedPool) => Promise<void>): Promise<void> {
    if (!seedPool) throw new Error("pool not initialised");
    const pool = seedPool;
    await pool.query("BEGIN");
    try {
      await pool.query("select set_config('app.current_organization', $1, true)", [eskomOrgId]);
      await pool.query("SET LOCAL lock_timeout = '5s'");
      await body(pool);
    } finally {
      await pool.query("ROLLBACK");
    }
  }

  type NodeRow = {
    key: string;
    symbol: string;
    role_code: string | null;
    is_source: boolean;
    is_switching: boolean;
    fan_out: boolean;
  };

  async function nodesOf(pool: Queryable, slug: string): Promise<NodeRow[]> {
    const res = await pool.query<NodeRow>(
      `SELECT n.key, n.symbol, n.role_code, n.is_source, n.is_switching, n.fan_out
         FROM bms.mimic_layout_nodes n JOIN bms.mimic_layouts l ON l.id = n.layout_id
        WHERE l.organization_id = $1 AND l.slug = $2
        ORDER BY n.key`,
      [eskomOrgId, slug],
    );
    return res.rows;
  }

  function tuple(row: NodeRow): string {
    const flag = (value: boolean): string => (value ? "T" : "F");
    return [row.key, row.symbol, row.role_code ?? "-", flag(row.is_source), flag(row.is_switching), flag(row.fan_out)].join(" ");
  }

  async function pipesOf(pool: Queryable, slug: string): Promise<string[]> {
    const res = await pool.query<{ pipe: string }>(
      `SELECT f.key || '->' || t.key AS pipe
         FROM bms.mimic_layout_pipes p
         JOIN bms.mimic_layouts l ON l.id = p.layout_id
         JOIN bms.mimic_layout_nodes f ON f.id = p.from_node_id
         JOIN bms.mimic_layout_nodes t ON t.id = p.to_node_id
        WHERE l.organization_id = $1 AND l.slug = $2`,
      [eskomOrgId, slug],
    );
    return res.rows.map((row) => row.pipe).sort();
  }

  /** Every count the seed writes, as one comparable value. */
  async function counts(pool: Queryable): Promise<string> {
    const res = await pool.query<{ snap: string }>(
      `SELECT concat_ws('/',
         (SELECT count(*) FROM bms.mimic_layouts WHERE organization_id = $1 AND slug = ANY($2::varchar[])),
         (SELECT count(*) FROM bms.mimic_layout_nodes n JOIN bms.mimic_layouts l ON l.id = n.layout_id
           WHERE l.organization_id = $1 AND l.slug = ANY($2::varchar[])),
         (SELECT count(*) FROM bms.mimic_layout_pipes p JOIN bms.mimic_layouts l ON l.id = p.layout_id
           WHERE l.organization_id = $1 AND l.slug = ANY($2::varchar[])),
         (SELECT count(*) FROM bms.asset_group_members agm JOIN bms.asset_groups g ON g.id = agm.asset_group_id
           WHERE g.location_id = $3 AND g.code IN ('demo-ht-lt-network', 'demo-flow-network')),
         (SELECT count(*) FROM bms.asset_points ap JOIN bms.assets a ON a.id = ap.asset_id
           WHERE a.location_id = $3 AND a.code = ANY($4::varchar[])
             AND ap.point_key IN ('breaker_main', 'breaker_trip', 'dg_on_load', 'valve_open', 'damper_open', 'pump_status')),
         (SELECT count(*) FROM bms.dashboards WHERE organization_id = $1 AND slug = ANY($2::varchar[])),
         (SELECT count(*) FROM bms.dashboard_widgets w JOIN bms.dashboards d ON d.id = w.dashboard_id
           WHERE d.organization_id = $1 AND d.slug = ANY($2::varchar[]))) AS snap`,
      [eskomOrgId, [HT_LT, FLOW], rsmocWcId, ALL_CODES],
    );
    return res.rows[0]?.snap ?? "";
  }

  // ------------------------------------------------------------------ what the seed left

  it("holds the HT/LT layout's fourteen nodes with exactly these symbols, roles and flags", async () => {
    expect((await nodesOf(probePool!, HT_LT)).map(tuple)).toEqual(HT_LT_NODES);
  });

  it("holds the flow layout's eight nodes with exactly these symbols, roles and flags", async () => {
    expect((await nodesOf(probePool!, FLOW)).map(tuple)).toEqual(FLOW_NODES);
  });

  it("holds exactly the HT/LT pipes", async () => {
    expect(await pipesOf(probePool!, HT_LT)).toEqual([...HT_LT_PIPES].sort());
  });

  it("holds exactly the flow pipes", async () => {
    expect(await pipesOf(probePool!, FLOW)).toEqual([...FLOW_PIPES].sort());
  });

  it("gives the HT/LT layout the core library and the flow layout core and qet", async () => {
    const res = await probePool!.query<{ row: string }>(
      `SELECT slug || '=' || array_to_string(symbol_libraries, ',') AS row FROM bms.mimic_layouts
        WHERE organization_id = $1 AND slug = ANY($2::varchar[]) ORDER BY slug`,
      [eskomOrgId, [HT_LT, FLOW]],
    );
    expect(res.rows.map((row) => row.row)).toEqual([`${FLOW}=core,qet`, `${HT_LT}=core`]);
  });

  /**
   * ADR 0101 d16 over the read-back graph: coupler open, DG breaker open (OQ4 (a)), every other
   * breaker closed, LT-A-F2 tripped. `dg->dg_cb` stays energised: a source's outbound is never
   * gated unless the source itself switches (ADR 0088) — asserted so nobody files it as a defect.
   */
  it("energiseGraph over the read-back HT/LT graph leaves branch A live and branch B dead", async () => {
    const nodes = await nodesOf(probePool!, HT_LT);
    const pipes = (await pipesOf(probePool!, HT_LT)).map((pipe) => {
      const [from, to] = pipe.split("->") as [string, string];
      return { from, to };
    });
    const held: Readonly<Record<string, readonly SwitchState[]>> = {
      coupler: ["open"],
      dg_cb: ["open"],
      fdr_a: ["closed", "tripped"],
    };
    const switching = nodes.filter((node) => node.is_switching || isSwitchingSymbol(node.symbol));
    const states = new Map<string, readonly SwitchState[]>(
      switching.map((node) => [node.key, held[node.key] ?? ["closed"]]),
    );
    const walk = energiseGraph(
      {
        nodes: nodes.map((node) => ({
          key: node.key,
          switching: node.is_switching || isSwitchingSymbol(node.symbol),
          fanOut: node.fan_out,
        })),
        pipes,
        sources: nodes.filter((node) => node.is_source).map((node) => node.key),
      },
      states,
    );
    const at = (from: string, to: string): string => walk?.pipes.get(mimicPipeKey(from, to)) ?? "absent";
    expect({
      switching: switching.length,
      gridToBusA: at("grid_cb", "bus_a"),
      busAToOutCb: at("bus_a", "out_cb_a"),
      dgCbToBusB: at("dg_cb", "bus_b"),
      isoBToTrB: at("iso_b", "tr_b"),
      dgToDgCb: at("dg", "dg_cb"),
    }).toEqual({
      // Seven switching nodes for eight breakers: LT-A-F1 and LT-A-F2 share the fan-out `fdr_a`.
      switching: 7,
      gridToBusA: "energised",
      busAToOutCb: "energised",
      dgCbToBusB: "de-energised",
      isoBToTrB: "de-energised",
      dgToDgCb: "energised",
    });
  });

  it("gives the fifteen memberships their roles, per code", async () => {
    const res = await probePool!.query<{ pair: string }>(
      `SELECT g.code || ':' || a.code || '=' || COALESCE(agm.role, '-') AS pair
         FROM bms.asset_group_members agm
         JOIN bms.asset_groups g ON g.id = agm.asset_group_id
         JOIN bms.assets a ON a.id = agm.asset_id
        WHERE g.organization_id = $1 AND g.location_id = $2
          AND g.code IN ('demo-ht-lt-network', 'demo-flow-network')`,
      [eskomOrgId, rsmocWcId],
    );
    expect(res.rows.map((row) => row.pair).sort()).toEqual([...MEMBERSHIPS].sort());
  });

  it("registers the state points per code as active unmapped rows", async () => {
    const res = await probePool!.query<{ pair: string }>(
      `SELECT a.code || '=' || ap.point_key AS pair
         FROM bms.asset_points ap JOIN bms.assets a ON a.id = ap.asset_id
        WHERE a.organization_id = $1 AND a.location_id = $2 AND a.code = ANY($3::varchar[])
          AND ap.point_key IN ('breaker_main', 'breaker_trip', 'dg_on_load', 'valve_open', 'damper_open', 'pump_status')
          AND ap.active = true AND ap.source_kind = 'unmapped' AND ap.rtu_id IS NULL`,
      [eskomOrgId, rsmocWcId, ALL_CODES],
    );
    expect(res.rows.map((row) => row.pair).sort()).toEqual([...STATE_POINTS, ...RULED_BREAKER_MAIN].sort());
  });

  it("writes the two dashboards on their groups, each mimic bound to its layout, and a breaker table on HT/LT only", async () => {
    const res = await probePool!.query<{ row: string }>(
      `SELECT d.slug || '@' || g.code || ':' || w.widget_type || ':' ||
              CASE WHEN w.widget_type = 'mimic'
                   THEN (w.config->>'source') || '=' || (w.config->>'layoutId' = l.id::text)::text
                   ELSE w.config::text END AS row
         FROM bms.dashboards d
         JOIN bms.asset_groups g ON g.id = d.asset_group_id
         JOIN bms.dashboard_widgets w ON w.dashboard_id = d.id
         LEFT JOIN bms.mimic_layouts l ON l.organization_id = d.organization_id AND l.slug = d.slug
        WHERE d.organization_id = $1 AND d.slug = ANY($2::varchar[])
        ORDER BY 1`,
      [eskomOrgId, [HT_LT, FLOW]],
    );
    expect(res.rows.map((row) => row.row)).toEqual([
      `${FLOW}@demo-flow-network:mimic:layout=true`,
      `${HT_LT}@demo-ht-lt-network:breaker_table:{}`,
      `${HT_LT}@demo-ht-lt-network:mimic:layout=true`,
    ]);
  });

  it("writes no PHEWB row: ESKOM holds two layouts, two groups and two dashboards, PHEWB none", async () => {
    const res = await probePool!.query<{ row: string }>(
      `SELECT o.code || ' layouts=' ||
              (SELECT count(*) FROM bms.mimic_layouts l WHERE l.organization_id = o.id AND l.slug LIKE 'network-demo-%') ||
              ' groups=' ||
              (SELECT count(*) FROM bms.asset_groups g WHERE g.organization_id = o.id
                 AND g.code IN ('demo-ht-lt-network', 'demo-flow-network')) ||
              ' dashboards=' ||
              (SELECT count(*) FROM bms.dashboards d WHERE d.organization_id = o.id AND d.slug LIKE 'network-demo-%')
              AS row
         FROM bms.organizations o WHERE o.code IN ('ESKOM', 'PHEWB') ORDER BY o.code`,
    );
    expect(res.rows.map((row) => row.row)).toEqual([
      "ESKOM layouts=2 groups=2 dashboards=2",
      "PHEWB layouts=0 groups=0 dashboards=0",
    ]);
  });

  it("finds every symbol the layouts draw as an active row of bms.mimic_symbols", async () => {
    const wanted = ["valve", "pump", "tank", "ahu", "discharge", "qet:air-damper", "breaker", "switchboard", "generator", "transformer"];
    const res = await probePool!.query<{ key: string }>(
      `SELECT key FROM bms.mimic_symbols WHERE key = ANY($1::varchar[]) AND active ORDER BY key`,
      [wanted],
    );
    expect(res.rows.map((row) => row.key)).toEqual([...wanted].sort());
  });

  describe("MimicNodesService.read", () => {
    async function readDashboard(slug: string): Promise<NodesAnswer> {
      const dashboard = await probePool!.query<{ id: string }>(
        `SELECT id FROM bms.dashboards WHERE organization_id = $1 AND slug = $2`,
        [eskomOrgId, slug],
      );
      const dashboardId = dashboard.rows[0]?.id;
      if (!dashboardId) throw new Error(`no ${slug} dashboard`);
      const { MimicNodesService } = require_(
        "../apps/api/dist/dashboard-builder/mimic-nodes.service.js",
      ) as MimicNodesServiceModule;
      return new MimicNodesService({}, probePool, {}).read(eskomOrgId, dashboardId, null, Date.now());
    }

    it("answers the coupler with breaker_main and breaker_trip state points", async () => {
      const answer = await readDashboard(HT_LT);
      const coupler = answer.widgets[0]?.nodes.find((node) => node.key === "coupler");
      expect({
        widgets: answer.widgets.map((widget) => widget.source),
        points: coupler?.statePoints.map((point) => point.pointKey).sort(),
      }).toEqual({ widgets: ["layout"], points: ["breaker_main", "breaker_trip"] });
    });

    it("answers iso_v1 with valve_open and the valve_open map with tones shut and flowing", async () => {
      const answer = await readDashboard(FLOW);
      const iso = answer.widgets[0]?.nodes.find((node) => node.key === "iso_v1");
      const map = answer.stateMaps.find((entry) => entry.pointKey === "valve_open");
      expect({
        points: iso?.statePoints.map((point) => point.pointKey),
        states: [...(map?.states ?? [])].sort((a, b) => a.value - b.value).map((s) => `${s.value}:${s.label}:${s.tone}`),
      }).toEqual({ points: ["valve_open"], states: ["0:SHUT:shut", "1:OPEN:flowing"] });
    });
  });

  // ------------------------------------------------------------------ a re-seed

  it("changes no count on a second seedNetworkDemo", async () => {
    let before = "";
    let after = "";
    await inTransaction(async (pool) => {
      before = await counts(pool);
      await seedNetworkDemo(pool, eskomOrgId, rsmocWcId, silent);
      after = await counts(pool);
    });
    // 24 points: the seed's twenty-one and the three ruled `breaker_main` rows (RULED_BREAKER_MAIN).
    expect({ before, after }).toEqual({ before: "2/22/22/15/24/2/3", after: "2/22/22/15/24/2/3" });
  });

  it("keeps an operator's node move and version bump over a re-seed", async () => {
    let read = "";
    await inTransaction(async (pool) => {
      const moved = await pool.query(
        `UPDATE bms.mimic_layout_nodes n SET x = 3, y = 4 FROM bms.mimic_layouts l
          WHERE l.id = n.layout_id AND l.organization_id = $1 AND l.slug = $2 AND n.key = 'grid_cb'`,
        [eskomOrgId, HT_LT],
      );
      const bumped = await pool.query(
        `UPDATE bms.mimic_layouts SET version = version + 1 WHERE organization_id = $1 AND slug = $2`,
        [eskomOrgId, HT_LT],
      );
      if (moved.rowCount !== 1 || bumped.rowCount !== 1) throw new Error("precondition: the operator edit landed");
      await seedNetworkDemo(pool, eskomOrgId, rsmocWcId, silent);
      const res = await pool.query<{ row: string }>(
        `SELECT n.x || ',' || n.y || ' v' || l.version AS row
           FROM bms.mimic_layout_nodes n JOIN bms.mimic_layouts l ON l.id = n.layout_id
          WHERE l.organization_id = $1 AND l.slug = $2 AND n.key = 'grid_cb'`,
        [eskomOrgId, HT_LT],
      );
      read = res.rows.map((row) => row.row).join(";");
    });
    expect(read).toBe("3,4 v2");
  });

  // Mutation: write nodes on every pass (`ON CONFLICT DO NOTHING` per node) → tr_b comes back → red.
  it("does not put back a node an operator deleted", async () => {
    let keys: string[] = [];
    await inTransaction(async (pool) => {
      const gone = await pool.query(
        `DELETE FROM bms.mimic_layout_nodes n USING bms.mimic_layouts l
          WHERE l.id = n.layout_id AND l.organization_id = $1 AND l.slug = $2 AND n.key = 'tr_b'`,
        [eskomOrgId, HT_LT],
      );
      if (gone.rowCount !== 1) throw new Error("precondition: tr_b was deleted");
      await seedNetworkDemo(pool, eskomOrgId, rsmocWcId, silent);
      keys = (await nodesOf(pool, HT_LT)).map((node) => node.key);
    });
    expect({ count: keys.length, hasTrB: keys.includes("tr_b"), hasTrA: keys.includes("tr_a") }).toEqual({
      count: 13,
      hasTrB: false,
      hasTrA: true,
    });
  });

  it("writes the full layout again when the layout row is absent", async () => {
    let tuples: string[] = [];
    let pipes: string[] = [];
    await inTransaction(async (pool) => {
      const gone = await pool.query(`DELETE FROM bms.mimic_layouts WHERE organization_id = $1 AND slug = $2`, [
        eskomOrgId,
        FLOW,
      ]);
      if (gone.rowCount !== 1) throw new Error("precondition: the flow layout was deleted");
      await seedNetworkDemo(pool, eskomOrgId, rsmocWcId, silent);
      tuples = (await nodesOf(pool, FLOW)).map(tuple);
      pipes = await pipesOf(pool, FLOW);
    });
    expect({ tuples, pipes }).toEqual({ tuples: FLOW_NODES, pipes: [...FLOW_PIPES].sort() });
  });

  it("keeps an administrator's role on a membership over a re-seed", async () => {
    let pairs: string[] = [];
    await inTransaction(async (pool) => {
      const changed = await pool.query(
        `UPDATE bms.asset_group_members agm SET role = 'mains-feeder-breaker'
           FROM bms.asset_groups g, bms.assets a
          WHERE g.id = agm.asset_group_id AND a.id = agm.asset_id
            AND g.location_id = $1 AND g.code = 'demo-ht-lt-network' AND a.code = 'ND-LT-A-F2'`,
        [rsmocWcId],
      );
      if (changed.rowCount !== 1) throw new Error("precondition: the role was changed");
      await seedNetworkDemo(pool, eskomOrgId, rsmocWcId, silent);
      const res = await pool.query<{ pair: string }>(
        `SELECT a.code || '=' || agm.role AS pair FROM bms.asset_group_members agm
           JOIN bms.asset_groups g ON g.id = agm.asset_group_id JOIN bms.assets a ON a.id = agm.asset_id
          WHERE g.location_id = $1 AND g.code = 'demo-ht-lt-network' AND a.code IN ('ND-LT-A-F1', 'ND-LT-A-F2')
          ORDER BY 1`,
        [rsmocWcId],
      );
      pairs = res.rows.map((row) => row.pair);
    });
    expect(pairs).toEqual(["ND-LT-A-F1=load-feeder-breaker", "ND-LT-A-F2=mains-feeder-breaker"]);
  });

  describe("when RSMOC-WC has no seed row", () => {
    it("logs one line and writes nothing", async () => {
      const lines: string[] = [];
      let after = "";
      await inTransaction(async (pool) => {
        await pool.query(`DELETE FROM bms.dashboards WHERE organization_id = $1 AND slug = ANY($2::varchar[])`, [
          eskomOrgId,
          [HT_LT, FLOW],
        ]);
        await pool.query(`DELETE FROM bms.mimic_layouts WHERE organization_id = $1 AND slug = ANY($2::varchar[])`, [
          eskomOrgId,
          [HT_LT, FLOW],
        ]);
        await seedNetworkDemo(pool, eskomOrgId, null, (line) => lines.push(line));
        after = (await counts(pool)).split("/").filter((_, index) => index === 0 || index === 5).join("/");
      });
      expect({ lines: lines.length, after }).toEqual({ lines: 1, after: "0/0" });
    });
  });
});
