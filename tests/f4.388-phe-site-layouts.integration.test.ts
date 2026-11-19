import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type * as AssetGroupsSeed from "../packages/db/dist/asset-groups-seed.js";
import type * as DbClient from "../packages/db/dist/client.js";
import type * as EskomLocationsSeed from "../packages/db/dist/eskom-locations-seed.js";
import type * as PheMapSeed from "../packages/db/dist/phe-map-seed.js";
import type * as PhePilotSeed from "../packages/db/dist/phe-pilot-seed.js";
import type * as SeedTenant from "../packages/db/dist/seed-tenant.js";
import type * as SiteLayoutSeedMove from "../packages/db/dist/site-layout-seed-move.js";
import type * as VerifyHierarchyExpected from "../packages/db/dist/verify-hierarchy-expected.js";
import type * as VerifyHierarchySeed from "../packages/db/dist/verify-hierarchy-seed.js";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";
import { PHE_SPLIT_STATION_CODES } from "../packages/db/src/phe-split-stations.js";
import { assertDatabaseName, copyDatabase, dropDatabaseIfExists } from "./harness/template-database";
import { withDatabase, workerDatabaseName } from "./harness/worker-database";

// Loaded from `packages/db/dist` through `createRequire`, as
// `tests/f4.388-phe-site-split.integration.test.ts` does and for its reason.
// After a seed source edit, run `pnpm --filter @bms/db build` first.
const require_ = createRequire(import.meta.url);
const { loadPheCatalog, pheRtuSites, seedPheCatalog, stationSlug } = require_(
  "../packages/db/dist/phe-pilot-seed.js",
) as typeof PhePilotSeed;
const { pheMapLocationRowsForInsert, pheSiteMapLocationRows } = require_(
  "../packages/db/dist/phe-map-seed.js",
) as typeof PheMapSeed;
const { seedMapLocations } = require_("../packages/db/dist/eskom-locations-seed.js") as typeof EskomLocationsSeed;
const { seedPhewbSiteLayouts } = require_(
  "../packages/db/dist/site-layout-seed-move.js",
) as typeof SiteLayoutSeedMove;
const { failingChecks, readPhewbChecks } = require_(
  "../packages/db/dist/verify-hierarchy-seed.js",
) as typeof VerifyHierarchySeed;
const { hierarchyExpectations } = require_(
  "../packages/db/dist/verify-hierarchy-expected.js",
) as typeof VerifyHierarchyExpected;
const { backfillAssetLocations, seedAssetGroups } = require_(
  "../packages/db/dist/asset-groups-seed.js",
) as typeof AssetGroupsSeed;
const { createDb } = require_("../packages/db/dist/client.js") as typeof DbClient;
const { createSeedPool, withOrganization } = require_("../packages/db/dist/seed-tenant.js") as typeof SeedTenant;

/**
 * `F4.388` (ADR 0139 decisions 6, 7, 9; plan Task 5, D7 and D8) — a split
 * station's site layouts, its unlinked view, and its sites' map rows, through
 * the whole PHEWB path twice.
 *
 * **This suite splits the real Lotapata, and a split never moves back**, so it
 * cannot run on its worker's database copy (ADR 0124): every later file on
 * that worker would read a split station. It makes **its own copy** of the
 * run's seeded template, `<worker database>_f4388`: the name comes from the
 * harness (`workerDatabaseName` under the run's prefix), and the harness's
 * guarded `copyDatabase` / `dropDatabaseIfExists` create and drop it. The
 * harness's name guard accepts that per-suite suffix under the run's prefix,
 * so on an external server the end-of-run `dropRunDatabases` also drops a copy
 * a killed or failed run left. `afterAll` drops it in a `finally` after the
 * pools close. With no isolating run context (the `shared` mode) there is no
 * template to copy, and it skips.
 *
 * The split path runs through the injected `catalog` and `splitStationCodes`
 * (plan D2). The template is seeded with the committed list, so a real station
 * on it is born split there (release B: Lotapata). The real stations therefore
 * ride along on the committed list, and synthetic stations (Lotapata's 2 RTUs
 * and 8 devices under run-tagged codes) cover the demo-host path (B: seeded
 * unsplit, then split), the cold path, a skipped site and an administrator's
 * view.
 *
 * Connection `"owner"`, as `pnpm db:seed` runs, so `FORCE ROW LEVEL SECURITY`
 * binds every write.
 */

const ownerUrl = requireIntegrationDb({
  item: "F4.388",
  label: "a split station's site layouts, view and map rows",
  because:
    "the station's view is unlinked in the move's transaction, a cold station's generated view is an " +
    "ON CONFLICT insert under FORCE RLS, and the boot gate reads them; only a real Postgres has them.",
  connection: "owner",
});

const runContext = inject("f45Run");
const isolating = runContext?.kind === "isolating" ? runContext : undefined;

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type SeedPool = ReturnType<typeof createSeedPool>;
type SeedDb = ReturnType<typeof createDb>;
type Catalog = PhePilotSeed.PheCatalogFile;
type Outcome = PhePilotSeed.PheSeedOutcome;
type SkippedSite = Outcome["skippedSites"][number];

const RUN = randomUUID().slice(0, 8).toUpperCase();
const run = RUN.toLowerCase();
const RTU_BASE = 1_100_000_000 + (parseInt(RUN.slice(0, 6), 16) % 1_000_000) * 100;

const real = loadPheCatalog();
const lotapataRows = real.rows.filter((row) => row.StationCode === "CBLTPT1");

/** A copy of Lotapata (2 RTUs, 8 devices) under run-tagged identities. */
function syntheticStation(n: number): Catalog {
  const rtuIds = [...new Set(lotapataRows.map((row) => row.EdgeRTUId))];
  const stationName = `Layout ${run} ${n}`;
  return {
    ...real,
    rows: lotapataRows.map((row) => {
      const index = rtuIds.indexOf(row.EdgeRTUId);
      return {
        ...row,
        EdgeRTUId: RTU_BASE + n * 2 + index,
        RTUCode: `L${RUN}${n}${index}`,
        MqttTopic: `test/f4.388-layouts/${RUN}/${n}/${index}`,
        RTUDisplayName: `${stationName} ${index === 0 ? "I" : "II"}`,
        StationId: 910_000 + n,
        StationCode: `L${RUN}${n}`,
        StationName: stationName,
        DeviceId: 910_000 + n * 100 + row.DeviceId,
        DeviceCode: row.DeviceCode.replace(/-\d+$/, `-Y${RUN}${n}${index}`),
      };
    }),
  };
}

const catalogOf = (...stations: Catalog[]): Catalog => ({
  ...real,
  rows: stations.flatMap((station) => station.rows),
});
const codeOf = (station: Catalog): string => station.rows[0]?.StationCode ?? "";
const slugOf = (station: Catalog): string => stationSlug(station.rows[0]?.StationName ?? "");
const siteSlug = (slug: string): string => `site-layout-${slug}`;

describe.skipIf(!ownerUrl || !isolating)("F4.388 — a split station's site layouts, view and map rows", () => {
  let ownDatabase = "";
  let superPool: IntegrationPool | undefined;
  let seedPool: SeedPool | undefined;
  let seedDb: SeedDb | undefined;
  let phewbOrgId = "";
  let eskomOrgId = "";

  beforeAll(async () => {
    if (!isolating) throw new Error("no isolating run context");
    const url = ownerUrl as string;
    // The harness's own name for this worker's copy, plus this suite's suffix; the harness's
    // guard holds it to the run's prefix on an external server before it goes into SQL.
    const workerDatabase = workerDatabaseName(process.env.VITEST_POOL_ID, isolating.prefix);
    if (new URL(url).pathname.slice(1) !== workerDatabase) {
      throw new Error(`F4.388: the owner URL does not name this worker's database ${workerDatabase}`);
    }
    ownDatabase = assertDatabaseName(`${workerDatabase}_f4388`, isolating.server);
    await dropDatabaseIfExists(isolating.superuserUrl, ownDatabase, isolating.server);
    await copyDatabase(isolating.superuserUrl, isolating.template, ownDatabase, isolating.server);
    superPool = await openIntegrationPool(
      withDatabase(resolveIntegrationRoleUrl(url, "superuser", process.env), ownDatabase),
      "F4.388",
    );
    seedPool = createSeedPool(withDatabase(url, ownDatabase));
    seedDb = createDb(seedPool);
    const orgs = await superPool.query<{ id: string; code: string }>(
      `SELECT id, code FROM bms.organizations WHERE code = ANY($1::varchar[])`,
      [["ESKOM", "PHEWB"]],
    );
    eskomOrgId = orgs.rows.find((row) => row.code === "ESKOM")?.id ?? "";
    phewbOrgId = orgs.rows.find((row) => row.code === "PHEWB")?.id ?? "";
    if (eskomOrgId === "" || phewbOrgId === "") throw new Error("the template holds no ESKOM or PHEWB");
  }, 120_000);

  afterAll(async () => {
    try {
      await seedPool?.end();
      await superPool?.end();
    } finally {
      if (isolating && ownDatabase !== "") {
        await dropDatabaseIfExists(isolating.superuserUrl, ownDatabase, isolating.server);
      }
    }
  }, 120_000);

  function pools(): { pool: SeedPool; db: SeedDb; superuser: IntegrationPool } {
    if (!seedPool || !seedDb || !superPool) throw new Error("pool not initialised");
    return { pool: seedPool, db: seedDb, superuser: superPool };
  }

  /**
   * The PHEWB path of `seed.ts`: the PHE map rows before any tenant bracket;
   * bracket 1 (the catalog, the site map rows, the derivation pass and the
   * groups); bracket 2 (the site layouts).
   */
  async function wholePath(catalog: Catalog, codes: readonly string[], lines: string[] = []): Promise<Outcome> {
    const { pool, db, superuser } = pools();
    const log = (line: string): void => {
      lines.push(line);
    };
    await seedMapLocations(db, pheMapLocationRowsForInsert(catalog));
    const outcome = await withOrganization(pool, phewbOrgId, async () => {
      const seeded = await seedPheCatalog(db, pool, {
        catalog,
        splitStationCodes: codes,
        holderReader: superuser,
        log,
      });
      await seedMapLocations(db, pheSiteMapLocationRows(seeded.sites, catalog));
      await backfillAssetLocations(pool);
      await seedAssetGroups(pool, phewbOrgId);
      return seeded;
    });
    await withOrganization(pool, phewbOrgId, () => seedPhewbSiteLayouts(pool, phewbOrgId, catalog, log, codes));
    return outcome;
  }

  /** `readPhewbChecks` in PHEWB's context, rolled back; returns the failure lines. */
  async function gateFailures(
    catalog: Catalog,
    codes: readonly string[],
    skipped: readonly SkippedSite[] = [],
  ): Promise<string[]> {
    const { pool } = pools();
    await pool.query("BEGIN");
    try {
      await pool.query("select set_config('app.current_organization', $1, true)", [phewbOrgId]);
      const checks = await readPhewbChecks(pool, hierarchyExpectations(catalog, codes), {
        pheSkippedSites: skipped,
        log: () => undefined,
      });
      return failingChecks(checks);
    } finally {
      await pool.query("ROLLBACK");
    }
  }

  async function locationId(slug: string): Promise<string> {
    const res = await pools().superuser.query<{ id: string }>(`SELECT id FROM bms.locations WHERE slug = $1`, [slug]);
    const id = res.rows[0]?.id;
    if (!id) throw new Error(`no location ${slug}`);
    return id;
  }

  async function viewOf(slug: string): Promise<{ kind: string; dashboard_id: string | null } | undefined> {
    const res = await pools().superuser.query<{ kind: string; dashboard_id: string | null }>(
      `SELECT v.kind, v.dashboard_id FROM bms.site_control_room_views v
         JOIN bms.locations l ON l.id = v.location_id WHERE l.slug = $1`,
      [slug],
    );
    return res.rows[0];
  }

  async function dashboardOf(slug: string): Promise<{ id: string; location_id: string; tabs: number } | undefined> {
    const res = await pools().superuser.query<{ id: string; location_id: string; tabs: number }>(
      `SELECT d.id, d.location_id, (SELECT count(*)::int FROM bms.dashboard_tabs t WHERE t.dashboard_id = d.id) AS tabs
         FROM bms.dashboards d WHERE d.organization_id = $1 AND d.slug = $2`,
      [phewbOrgId, slug],
    );
    return res.rows[0];
  }

  /** A site's copy: its view names it, and each of its three tabs binds one of the site's own groups. */
  async function expectSiteCopy(slug: string): Promise<void> {
    const site = await locationId(slug);
    const copy = await dashboardOf(siteSlug(slug));
    expect(copy?.location_id, `${slug}'s copy is at the site`).toBe(site);
    expect(await viewOf(slug)).toEqual({ kind: "dashboard", dashboard_id: copy?.id });
    const tabs = await pools().superuser.query<{ tab_key: string; group_code: string; group_at: string }>(
      `SELECT t.tab_key, g.code AS group_code, g.location_id AS group_at
         FROM bms.dashboard_tabs t JOIN bms.asset_groups g ON g.id = t.asset_group_id
        WHERE t.dashboard_id = $1 ORDER BY t.sort_order`,
      [copy?.id],
    );
    expect(tabs.rows.map((row) => [row.tab_key, row.group_code, row.group_at])).toEqual([
      ["overview", "pump-station", site],
      ["electrical", "electrical", site],
      ["env", "environment", site],
    ]);
  }

  /** PHEWB's rows of the path's tables and its PHE map rows, ordered, without `updated_at`. */
  async function snapshot(): Promise<string> {
    const tables = [
      "locations",
      "rtus",
      "assets",
      "asset_groups",
      "asset_group_members",
      "dashboards",
      "dashboard_tabs",
      "site_control_room_views",
      "location_tariffs",
      "location_tariff_meters",
    ];
    const parts: string[] = [];
    for (const table of tables) {
      const res = await pools().superuser.query<{ row: unknown }>(
        `SELECT to_jsonb(t) - 'updated_at' AS row FROM bms.${table} t
          WHERE ${
            table === "asset_group_members"
              ? "t.asset_group_id IN (SELECT g.id FROM bms.asset_groups g WHERE g.organization_id = $1)"
              : "t.organization_id = $1"
          } ORDER BY to_jsonb(t)::text`,
        [phewbOrgId],
      );
      parts.push(`${table}:${JSON.stringify(res.rows.map((r) => r.row))}`);
    }
    const map = await pools().superuser.query<{ row: unknown }>(
      `SELECT to_jsonb(m) AS row FROM bms.map_locations m
        WHERE m.meta->>'organizationCode' = 'PHEWB' ORDER BY m.slug`,
    );
    parts.push(`map_locations:${JSON.stringify(map.rows.map((r) => r.row))}`);
    return parts.join("\n");
  }

  async function mapRow(slug: string): Promise<Record<string, unknown> | undefined> {
    const res = await pools().superuser.query<{ row: Record<string, unknown> }>(
      `SELECT to_jsonb(m) AS row FROM bms.map_locations m WHERE m.slug = $1`,
      [slug],
    );
    return res.rows[0]?.row;
  }

  // ── L2: an administrator's view survives the split (synthetic E) ──
  it("L2 a station whose view an administrator pointed at another dashboard keeps that view", async () => {
    const E = syntheticStation(5);
    await wholePath(E, []);
    const station = await locationId(slugOf(E));
    const seeded = await dashboardOf(siteSlug(slugOf(E)));
    expect(await viewOf(slugOf(E)), "the unsplit station's seeded copy").toEqual({
      kind: "dashboard",
      dashboard_id: seeded?.id,
    });
    const board = await pools().superuser.query<{ id: string }>(
      `INSERT INTO bms.dashboards (organization_id, slug, name, location_id)
       VALUES ($1, $2, 'An administrator''s board', $3) RETURNING id`,
      [phewbOrgId, `admin-board-${run}`, station],
    );
    const boardId = board.rows[0]?.id;
    await pools().superuser.query(`UPDATE bms.site_control_room_views SET dashboard_id = $1 WHERE location_id = $2`, [
      boardId,
      station,
    ]);

    const outcome = await wholePath(E, [codeOf(E)]);

    expect(outcome.movedExternalRtuIds, "the move ran, so the unlink was asked").toHaveLength(2);
    expect(await viewOf(slugOf(E))).toEqual({ kind: "dashboard", dashboard_id: boardId });
    expect((await dashboardOf(siteSlug(slugOf(E))))?.tabs, "the station's seeded copy stays").toBe(3);
    for (const site of pheRtuSites(E)) await expectSiteCopy(site.slug);
  }, 240_000);

  // ── Station B (the demo-host path: seeded unsplit, then split), a cold station C and a station D
  // with a skipped site; the real stations ride along on the committed list ──
  const B = syntheticStation(6);
  const C = syntheticStation(3);
  const D = syntheticStation(4);
  const CAT = catalogOf(real, B, C, D);
  const CODES = [...PHE_SPLIT_STATION_CODES, codeOf(B), codeOf(C), codeOf(D)];
  const realSplitSites = pheRtuSites(real).filter((site) => PHE_SPLIT_STATION_CODES.includes(site.stationCode));
  const bSites = pheRtuSites(B);
  const [dI, dII] = pheRtuSites(D);
  let bBefore: { view?: { kind: string; dashboard_id: string | null }; map?: Record<string, unknown> } = {};
  let run1: Outcome | undefined;
  let afterRun1 = "";
  const run1Lines: string[] = [];

  it("L1 a split station B's sites get the pump-station copies and the station's view is unlinked", async () => {
    if (!dI || !dII) throw new Error("station D has no two RTUs");
    // B as the demo host holds a station before its release: seeded with its code off the list.
    await wholePath(catalogOf(real, B), [...PHE_SPLIT_STATION_CODES]);
    const before = await dashboardOf(siteSlug(slugOf(B)));
    bBefore = { view: await viewOf(slugOf(B)), map: await mapRow(slugOf(B)) };
    expect(bBefore.view, "B's view is its seeded copy").toEqual({
      kind: "dashboard",
      dashboard_id: before?.id,
    });
    // Station D: another organization holds its first site's slug (owner ruling Q2).
    await pools().superuser.query(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
       VALUES ($1, $2, $3, $4, 'plant', 0, 0)`,
      [eskomOrgId, `ESK-L${RUN}-D`, dI.slug, `Holder ${dI.slug}`],
    );

    run1 = await wholePath(CAT, CODES, run1Lines);

    expect(run1.skippedSites.map((skip) => [skip.site.slug, skip.reason])).toEqual([[dI.slug, "foreign-slug"]]);
    expect(
      [...run1.movedExternalRtuIds].sort(),
      "B's two RTUs moved; C and D were born at their sites, the real split stations in the template",
    ).toEqual(bSites.map((site) => site.edgeRtuId).sort());
    for (const site of bSites) await expectSiteCopy(site.slug);
    expect(await viewOf(slugOf(B)), "decision 7 (Q5): unlinked").toEqual({
      kind: "generated",
      dashboard_id: null,
    });
    const after = await dashboardOf(siteSlug(slugOf(B)));
    expect(after, "the station's dashboard row and its tabs stay").toEqual(before);
    expect(run1Lines.filter((line) => line.includes("unlinked")), "one line for the one unlink").toHaveLength(1);
    afterRun1 = await snapshot();
  }, 300_000);

  it("L3 a station seeded cold on the list gets a generated view and no copy; its sites get copies", async () => {
    expect(await viewOf(slugOf(C))).toEqual({ kind: "generated", dashboard_id: null });
    expect(await dashboardOf(siteSlug(slugOf(C)))).toBeUndefined();
    for (const site of pheRtuSites(C)) await expectSiteCopy(site.slug);
    // D's skipped site keeps its RTU at the station, which still gets no copy.
    expect(await viewOf(slugOf(D))).toEqual({ kind: "generated", dashboard_id: null });
    expect(await dashboardOf(siteSlug(slugOf(D)))).toBeUndefined();
    if (dII) await expectSiteCopy(dII.slug);
  }, 60_000);

  it("L4 one map row per resolved site, none for a skipped site, the station's row unchanged", async () => {
    const resolved = run1?.sites ?? [];
    expect(resolved.map((site) => site.slug).sort()).toEqual(
      [...realSplitSites, ...bSites, ...pheRtuSites(C), dII].map((site) => site?.slug).sort(),
    );
    for (const site of resolved) {
      const row = await mapRow(site.slug);
      expect(row, `${site.slug} has a map row`).toMatchObject({
        name: site.name,
        site_name: site.locationName,
        latitude: site.latitude,
        longitude: site.longitude,
        meta: {
          source: "phe-catalog",
          organizationCode: "PHEWB",
          stationCode: site.stationCode,
          edgeRtuId: site.edgeRtuId,
        },
      });
    }
    expect(await mapRow(dI?.slug ?? ""), "a skipped site's slug gets no row").toBeUndefined();
    expect(await mapRow(slugOf(B))).toEqual(bBefore.map);
  }, 60_000);

  it("L5 the whole PHEWB path twice changes no row, and the gate holds after each run", async () => {
    const skips = run1?.skippedSites ?? [];
    expect(await gateFailures(CAT, CODES, skips), "after run 1").toEqual([]);
    const run2 = await wholePath(CAT, CODES);
    expect(run2.movedExternalRtuIds).toEqual([]);
    expect(run2.skippedSites).toEqual(skips);
    expect(await snapshot()).toBe(afterRun1);
    expect(await gateFailures(CAT, CODES, run2.skippedSites), "after run 2").toEqual([]);
  }, 300_000);

  it("L2b a station view an administrator re-links after the split stays linked on the next seed", async () => {
    const station = await locationId(slugOf(B));
    const old = await dashboardOf(siteSlug(slugOf(B)));
    await pools().superuser.query(
      `UPDATE bms.site_control_room_views SET kind = 'dashboard', dashboard_id = $1 WHERE location_id = $2`,
      [old?.id, station],
    );
    await wholePath(CAT, CODES);
    expect(await viewOf(slugOf(B)), "the unlink is the move's, once").toEqual({
      kind: "dashboard",
      dashboard_id: old?.id,
    });
  }, 300_000);
});
