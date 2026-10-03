import { createRequire } from "node:module";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as BreakerDemoSeed from "../packages/db/dist/breaker-demo-seed.js";
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
const { BREAKER_DEMO_DASHBOARD_SLUG, seedBreakerDemo } = require_(
  "../packages/db/dist/breaker-demo-seed.js",
) as typeof BreakerDemoSeed;
const { createSeedPool } = require_("../packages/db/dist/seed-tenant.js") as typeof SeedTenant;

/**
 * The resolver, from `apps/api/dist` (CI's `pnpm typecheck` builds it before the tests run; locally,
 * run `pnpm --filter api build` first). Required inside the suite, not at module load: `postinstall`
 * builds only `@bms/shared` and `@bms/db`, so a top-level require would fail this file on a machine
 * with no database instead of skipping it. Not an
 * `import`: the service's constructor-parameter decorators need `experimentalDecorators`, which
 * `tsconfig.typecheck-tests.json` does not set. So the shape is restated here, narrowly: only what
 * the two cases read.
 */
interface NodesAnswer {
  readonly widgets: ReadonlyArray<{
    readonly source: string;
    readonly nodes: ReadonlyArray<{
      readonly key: string;
      readonly memberCount: number;
      readonly members: ReadonlyArray<{ readonly asset: { readonly code: string } }>;
    }>;
  }>;
}
interface MimicNodesReader {
  read(organizationId: string, dashboardId: string, readable: readonly string[] | null, nowMs: number): Promise<NodesAnswer>;
}
type MimicNodesServiceModule = {
  MimicNodesService: new (fleetDb: unknown, pool: unknown, accessControl: unknown) => MimicNodesReader;
};

/**
 * `F3.74` plan D11 (ADR 0088 decisions 13 and 14) — the breaker demo at `RSMOC-WC`.
 *
 * **After a full `pnpm db:seed`**, the read cases check what the seed left. The cases that carry
 * the plan's mutations re-run `seedBreakerDemo` against a changed database, the `F1.7` precedent: a
 * single seed pass on a fresh database already writes the five breaker roles through
 * `seedAssetGroups`, so only a database that holds the old `mcc` role (or a hand-set rating) can
 * show the forced write and the `rating IS NULL` guard at work.
 *
 * **Every changing case is one `BEGIN` … `ROLLBACK`** on the seed pool's one connection, in ESKOM's
 * tenant context as `bms_owner` (the role `pnpm db:seed` runs as). Reads of the seeded state run on
 * a `bms_fleet` probe pool.
 */

const ownerUrl = requireIntegrationDb({
  item: "F3.74",
  label: "the breaker demo seed",
  because:
    "that a re-seed forces the twelve breaker roles at RSMOC-WC, keeps a hand-set rating, and " +
    "writes the demo dashboard once are database behaviours under row-level security across two passes.",
  connection: "owner",
});

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type SeedPool = ReturnType<typeof createSeedPool>;
type Queryable = Pick<SeedPool, "query">;

const BREAKER_ROLES: Readonly<Record<string, string>> = {
  "CR-Q1": "main-breaker",
  "CR-Q2": "ups-input-breaker",
  "CR-Q3": "ups-input-breaker",
  "CR-Q4": "ups-output-breaker",
  "CR-Q5": "ups-output-breaker",
  "CR-Q6": "load-feeder-breaker",
  "CR-Q7": "load-feeder-breaker",
  "CR-Q8": "load-feeder-breaker",
  "CR-Q9": "load-feeder-breaker",
  "CR-Q10": "mains-feeder-breaker",
  "CR-Q11": "mains-feeder-breaker",
  "CR-Q12": "mains-feeder-breaker",
};
const BREAKERS = Object.keys(BREAKER_ROLES);
const EXPECTED_BREAKER_ROLES = BREAKERS.map((code) => `${code}=${BREAKER_ROLES[code]}`).sort();

const silent = (): void => undefined;

describe.skipIf(!ownerUrl)("F3.74 D11 — the breaker demo seed at RSMOC-WC", { timeout: 60_000 }, () => {
  let probePool: IntegrationPool | undefined;
  let seedPool: SeedPool | undefined;
  let eskomOrgId = "";
  let rsmocWcId = "";

  beforeAll(async () => {
    const url = ownerUrl as string;
    probePool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "fleet", process.env), "F3.74");
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

  /** `code=role` of every member of RSMOC-WC's electrical group among `codes`, sorted. */
  async function electricalRoles(pool: Queryable, codes: readonly string[]): Promise<string[]> {
    const res = await pool.query<{ pair: string }>(
      `SELECT a.code || '=' || COALESCE(agm.role, '-') AS pair
         FROM bms.asset_group_members agm
         JOIN bms.asset_groups g ON g.id = agm.asset_group_id
         JOIN bms.assets a ON a.id = agm.asset_id
        WHERE g.location_id = $1 AND g.code = 'electrical' AND a.code = ANY($2::varchar[])
        ORDER BY 1`,
      [rsmocWcId, codes],
    );
    return res.rows.map((row) => row.pair).sort();
  }

  /** Sets the twelve breakers' electrical-group role, the state an earlier seed left. */
  async function setBreakerRoles(pool: Queryable, role: string): Promise<void> {
    await pool.query(
      `UPDATE bms.asset_group_members agm SET role = $3
         FROM bms.asset_groups g, bms.assets a
        WHERE g.id = agm.asset_group_id AND a.id = agm.asset_id
          AND g.location_id = $1 AND g.code = 'electrical' AND a.code = ANY($2::varchar[])`,
      [rsmocWcId, BREAKERS, role],
    );
  }

  async function nameplate(pool: Queryable, code: string): Promise<string> {
    const res = await pool.query<{ plate: string }>(
      `SELECT COALESCE(rating, '-') || '|' || COALESCE(trip_cause, '-') AS plate
         FROM bms.assets WHERE location_id = $1 AND code = $2`,
      [rsmocWcId, code],
    );
    return res.rows[0]?.plate ?? "absent";
  }

  /** Everything the seed writes, as one comparable value. */
  async function snapshot(pool: Queryable): Promise<string> {
    const res = await pool.query<{ snap: string }>(
      `SELECT concat_ws(' / ',
         (SELECT string_agg(a.code || '=' || COALESCE(agm.role, '-'), ',' ORDER BY a.code)
            FROM bms.asset_group_members agm
            JOIN bms.asset_groups g ON g.id = agm.asset_group_id
            JOIN bms.assets a ON a.id = agm.asset_id
           WHERE g.location_id = $1 AND g.code = 'electrical'),
         (SELECT count(*)::text FROM bms.asset_points ap JOIN bms.assets a ON a.id = ap.asset_id
           WHERE a.location_id = $1 AND ap.point_key = 'breaker_trip'),
         (SELECT string_agg(code || ':' || COALESCE(rating, '-') || ':' || COALESCE(trip_cause, '-'), ',' ORDER BY code)
            FROM bms.assets WHERE location_id = $1 AND code = ANY($2::varchar[])),
         (SELECT count(*)::text FROM bms.dashboards WHERE slug = $3),
         (SELECT string_agg(w.widget_type || '@' || w.grid_x || ',' || w.grid_y || ',' || w.grid_w || ',' || w.grid_h,
                            ',' ORDER BY w.widget_type)
            FROM bms.dashboard_widgets w JOIN bms.dashboards d ON d.id = w.dashboard_id
           WHERE d.slug = $3)) AS snap`,
      [rsmocWcId, BREAKERS, BREAKER_DEMO_DASHBOARD_SLUG],
    );
    return res.rows[0]?.snap ?? "";
  }

  // ------------------------------------------------------------------ what the seed left

  it("gives the twelve CR-Q breakers their five breaker roles in RSMOC-WC's electrical group", async () => {
    expect(await electricalRoles(probePool!, BREAKERS)).toEqual(EXPECTED_BREAKER_ROLES);
  });

  it("adds CR-UPS-1 and CR-UPS-2 to the group as ups", async () => {
    expect(await electricalRoles(probePool!, ["CR-UPS-1", "CR-UPS-2"])).toEqual(["CR-UPS-1=ups", "CR-UPS-2=ups"]);
  });

  it("adds the four rack PDUs to the group as pdu", async () => {
    const pdus = ["CR-NET-RACK-PDU-A", "CR-NET-RACK-PDU-B", "CR-VW-RACK-PDU-A", "CR-VW-RACK-PDU-B"];
    expect(await electricalRoles(probePool!, pdus)).toEqual(pdus.map((code) => `${code}=pdu`));
  });

  it("adds CR-HVAC-1 and CR-HVAC-2 to the group as crac", async () => {
    expect(await electricalRoles(probePool!, ["CR-HVAC-1", "CR-HVAC-2"])).toEqual([
      "CR-HVAC-1=crac",
      "CR-HVAC-2=crac",
    ]);
  });

  it("registers breaker_trip as an active point on each of the twelve breakers", async () => {
    const res = await probePool!.query<{ code: string }>(
      `SELECT a.code FROM bms.asset_points ap JOIN bms.assets a ON a.id = ap.asset_id
        WHERE a.location_id = $1 AND ap.point_key = 'breaker_trip' AND ap.active = true
        ORDER BY a.code`,
      [rsmocWcId],
    );
    expect(res.rows.map((row) => row.code).sort()).toEqual([...BREAKERS].sort());
  });

  it("writes CR-Q9's trip cause 'high I^2t'", async () => {
    expect(await nameplate(probePool!, "CR-Q9")).toBe("16 A|high I^2t");
  });

  it("writes CR-Q1's rating '100 A'", async () => {
    expect(await nameplate(probePool!, "CR-Q1")).toBe("100 A|-");
  });

  it("writes sld-demo-rsmoc-wc on the electrical group with one mimic and one breaker_table", async () => {
    const res = await probePool!.query<{ group_code: string | null; widgets: string }>(
      `SELECT g.code AS group_code,
              (SELECT string_agg(w.widget_type, ',' ORDER BY w.widget_type)
                 FROM bms.dashboard_widgets w WHERE w.dashboard_id = d.id) AS widgets
         FROM bms.dashboards d LEFT JOIN bms.asset_groups g ON g.id = d.asset_group_id
        WHERE d.slug = $1 AND d.organization_id = $2 AND g.location_id = $3`,
      [BREAKER_DEMO_DASHBOARD_SLUG, eskomOrgId, rsmocWcId],
    );
    expect(res.rows.map((row) => `${row.group_code}:${row.widgets}`)).toEqual(["electrical:breaker_table,mimic"]);
  });

  describe("MimicNodesService.read on sld-demo-rsmoc-wc", () => {
    async function nodesOf(): Promise<NodesAnswer["widgets"][number]["nodes"]> {
      const dashboard = await probePool!.query<{ id: string }>(
        `SELECT id FROM bms.dashboards WHERE organization_id = $1 AND slug = $2`,
        [eskomOrgId, BREAKER_DEMO_DASHBOARD_SLUG],
      );
      const dashboardId = dashboard.rows[0]?.id;
      if (!dashboardId) throw new Error(`no ${BREAKER_DEMO_DASHBOARD_SLUG} dashboard`);
      const { MimicNodesService } = require_(
        "../apps/api/dist/dashboard-builder/mimic-nodes.service.js",
      ) as MimicNodesServiceModule;
      const answer = await new MimicNodesService({}, probePool, {}).read(eskomOrgId, dashboardId, null, Date.now());
      const widget = answer.widgets[0];
      if (answer.widgets.length !== 1 || !widget) throw new Error(`want one mimic widget, got ${answer.widgets.length}`);
      return widget.nodes;
    }

    it("answers main_breaker with one member, CR-Q1", async () => {
      const node = (await nodesOf()).find((candidate) => candidate.key === "main_breaker");
      expect(node?.members.map((member) => member.asset.code)).toEqual(["CR-Q1"]);
    });

    it("answers load_feeders with four members, CR-Q6 to CR-Q9", async () => {
      const node = (await nodesOf()).find((candidate) => candidate.key === "load_feeders");
      expect(node?.members.map((member) => member.asset.code)).toEqual(["CR-Q6", "CR-Q7", "CR-Q8", "CR-Q9"]);
    });
  });

  // ------------------------------------------------------------------ a re-seed over a changed database

  it("forces the five breaker roles over the mcc an earlier seed left", async () => {
    await inTransaction(async (pool) => {
      await setBreakerRoles(pool, "mcc");
      await seedBreakerDemo(pool, eskomOrgId, rsmocWcId, silent);
      expect(await electricalRoles(pool, BREAKERS)).toEqual(EXPECTED_BREAKER_ROLES);
    });
  });

  // Mutation: drop the `WHERE … role IS NULL OR … = 'mcc'` of FORCE_ROLE_SQL → CR-Q9 is forced back → red.
  it("keeps an administrator's non-mcc role on CR-Q9 on a re-seed", async () => {
    await inTransaction(async (pool) => {
      await pool.query(
        `UPDATE bms.asset_group_members agm SET role = 'mains-feeder-breaker'
           FROM bms.asset_groups g, bms.assets a
          WHERE g.id = agm.asset_group_id AND a.id = agm.asset_id
            AND g.location_id = $1 AND g.code = 'electrical' AND a.code = 'CR-Q9'`,
        [rsmocWcId],
      );
      await seedBreakerDemo(pool, eskomOrgId, rsmocWcId, silent);
      expect(await electricalRoles(pool, ["CR-Q9", "CR-Q8"])).toEqual([
        "CR-Q8=load-feeder-breaker",
        "CR-Q9=mains-feeder-breaker",
      ]);
    });
  });

  it("adds CR-UPS-1 to the group as ups on a re-seed that finds it absent", async () => {
    await inTransaction(async (pool) => {
      await pool.query(
        `DELETE FROM bms.asset_group_members agm USING bms.asset_groups g, bms.assets a
          WHERE g.id = agm.asset_group_id AND a.id = agm.asset_id
            AND g.location_id = $1 AND g.code = 'electrical' AND a.code LIKE 'CR-UPS-%'`,
        [rsmocWcId],
      );
      await seedBreakerDemo(pool, eskomOrgId, rsmocWcId, silent);
      expect(await electricalRoles(pool, ["CR-UPS-1"])).toEqual(["CR-UPS-1=ups"]);
    });
  });

  it("never adds CR-UPS-OUT-BUS to the group", async () => {
    await inTransaction(async (pool) => {
      await seedBreakerDemo(pool, eskomOrgId, rsmocWcId, silent);
      expect(await electricalRoles(pool, ["CR-UPS-OUT-BUS"])).toEqual([]);
    });
  });

  it("keeps a rating an administrator set by hand", async () => {
    await inTransaction(async (pool) => {
      await pool.query(`UPDATE bms.assets SET rating = '125 A', trip_cause = NULL WHERE location_id = $1 AND code = 'CR-Q1'`, [
        rsmocWcId,
      ]);
      await seedBreakerDemo(pool, eskomOrgId, rsmocWcId, silent);
      expect(await nameplate(pool, "CR-Q1")).toBe("125 A|-");
    });
  });

  // Mutation: drop `AND trip_cause IS NULL` from NAMEPLATE_SQL → the hand-set cause is overwritten → red.
  it("keeps a trip cause set by hand on a breaker whose rating is unset", async () => {
    await inTransaction(async (pool) => {
      await pool.query(`UPDATE bms.assets SET rating = NULL, trip_cause = 'thermal' WHERE location_id = $1 AND code = 'CR-Q1'`, [
        rsmocWcId,
      ]);
      await seedBreakerDemo(pool, eskomOrgId, rsmocWcId, silent);
      expect(await nameplate(pool, "CR-Q1")).toBe("-|thermal");
    });
  });

  it("fills a rating that is unset", async () => {
    await inTransaction(async (pool) => {
      await pool.query(`UPDATE bms.assets SET rating = NULL, trip_cause = NULL WHERE location_id = $1 AND code = 'CR-Q11'`, [
        rsmocWcId,
      ]);
      await seedBreakerDemo(pool, eskomOrgId, rsmocWcId, silent);
      expect(await nameplate(pool, "CR-Q11")).toBe("25 A|manual");
    });
  });

  it("changes nothing on a second pass", async () => {
    await inTransaction(async (pool) => {
      await seedBreakerDemo(pool, eskomOrgId, rsmocWcId, silent);
      const first = await snapshot(pool);
      await seedBreakerDemo(pool, eskomOrgId, rsmocWcId, silent);
      expect(await snapshot(pool)).toBe(first);
    });
  });

  it("writes the demo once: a second pass leaves one dashboard with two widgets", async () => {
    await inTransaction(async (pool) => {
      await seedBreakerDemo(pool, eskomOrgId, rsmocWcId, silent);
      await seedBreakerDemo(pool, eskomOrgId, rsmocWcId, silent);
      expect((await snapshot(pool)).split(" / ").slice(3)).toEqual(["1", "breaker_table@0,10,12,5,mimic@0,0,12,10"]);
    });
  });

  /**
   * The slug is held by a dashboard on another group: the seed adds no widget to it, logs one
   * line, and does not throw (a throw would fail every boot).
   * Mutation: drop the group check (`ours` always true) → two widgets land on it → red.
   */
  it("adds no widget to a dashboard that holds the slug on another group, and logs one line", async () => {
    const lines: string[] = [];
    let outcome = "";
    await inTransaction(async (pool) => {
      const other = await pool.query<{ id: string }>(
        `SELECT id FROM bms.asset_groups WHERE location_id = $1 AND code <> 'electrical' ORDER BY code LIMIT 1`,
        [rsmocWcId],
      );
      const otherId = other.rows[0]?.id;
      if (!otherId) throw new Error("precondition: RSMOC-WC holds a second asset group");
      const moved = await pool.query(
        `UPDATE bms.dashboards SET asset_group_id = $3 WHERE organization_id = $1 AND slug = $2`,
        [eskomOrgId, BREAKER_DEMO_DASHBOARD_SLUG, otherId],
      );
      if (moved.rowCount !== 1) throw new Error("precondition: the demo dashboard was re-pointed");
      await pool.query(
        `DELETE FROM bms.dashboard_widgets w USING bms.dashboards d
          WHERE d.id = w.dashboard_id AND d.organization_id = $1 AND d.slug = $2`,
        [eskomOrgId, BREAKER_DEMO_DASHBOARD_SLUG],
      );
      try {
        await seedBreakerDemo(pool, eskomOrgId, rsmocWcId, (line) => lines.push(line));
        outcome = "ok";
      } catch (error) {
        outcome = `threw: ${(error as Error).message}`;
      }
      const widgets = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM bms.dashboard_widgets w JOIN bms.dashboards d ON d.id = w.dashboard_id
          WHERE d.organization_id = $1 AND d.slug = $2`,
        [eskomOrgId, BREAKER_DEMO_DASHBOARD_SLUG],
      );
      outcome += ` widgets=${widgets.rows[0]?.n ?? -1}`;
    });
    expect({ outcome, lines: lines.length }).toEqual({ outcome: "ok widgets=0", lines: 1 });
  });

  describe("when RSMOC-WC has no seed row", () => {
    it("logs one line", async () => {
      const lines: string[] = [];
      await inTransaction(async (pool) => {
        await seedBreakerDemo(pool, eskomOrgId, null, (line) => lines.push(line));
      });
      expect(lines).toHaveLength(1);
    });

    it("writes no demo dashboard", async () => {
      await inTransaction(async (pool) => {
        await pool.query(`DELETE FROM bms.dashboards WHERE organization_id = $1 AND slug = $2`, [
          eskomOrgId,
          BREAKER_DEMO_DASHBOARD_SLUG,
        ]);
        await seedBreakerDemo(pool, eskomOrgId, null, silent);
        expect((await snapshot(pool)).split(" / ").slice(3)).toEqual(["0"]);
      });
    });
  });
});
