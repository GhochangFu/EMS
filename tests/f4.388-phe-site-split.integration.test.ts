import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as AssetGroupsSeed from "../packages/db/dist/asset-groups-seed.js";
import type * as DbClient from "../packages/db/dist/client.js";
import type * as PhePilotSeed from "../packages/db/dist/phe-pilot-seed.js";
import type * as SeedTenant from "../packages/db/dist/seed-tenant.js";
import type * as VerifyHierarchyExpected from "../packages/db/dist/verify-hierarchy-expected.js";
import type * as VerifyHierarchySeed from "../packages/db/dist/verify-hierarchy-seed.js";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

// Loaded from `packages/db/dist` through `createRequire`, as
// `tests/f4.169-f4.170-seed-owned-rows.integration.test.ts` does and for its
// reason. After a seed source edit, run `pnpm --filter @bms/db build` first.
const require_ = createRequire(import.meta.url);
const { loadPheCatalog, pheRtuSites, seedPheCatalog, stationSlug } = require_(
  "../packages/db/dist/phe-pilot-seed.js",
) as typeof PhePilotSeed;
const {
  PHE_RTU_SLUG_SHAPE_LABEL,
  PHE_SPLIT_ASSETS_LABEL,
  PHE_SPLIT_RTUS_LABEL,
  PHE_SPLIT_SITES_LABEL,
  failingChecks,
  readPhewbChecks,
} = require_("../packages/db/dist/verify-hierarchy-seed.js") as typeof VerifyHierarchySeed;
const { hierarchyExpectations } = require_(
  "../packages/db/dist/verify-hierarchy-expected.js",
) as typeof VerifyHierarchyExpected;
const { seedAssetGroups } = require_("../packages/db/dist/asset-groups-seed.js") as typeof AssetGroupsSeed;
const { createDb } = require_("../packages/db/dist/client.js") as typeof DbClient;
const { createSeedPool, withOrganization } = require_("../packages/db/dist/seed-tenant.js") as typeof SeedTenant;

/**
 * `F4.388` (ADR 0139 decisions 1–5, 4a, 10, 11; plan Task 4) — the PHE seed
 * splits a station into one site per RTU.
 *
 * Every case runs the split path through `seedPheCatalog`'s injected
 * `catalog` and `splitStationCodes` (plan D2): the committed list stays empty.
 * Each case seeds its own synthetic stations, copied from Lotapata's 2 RTUs
 * and 8 devices with run-tagged codes, so the real PHEWB rows are never
 * touched and the cases share no row. The seed runs in `withOrganization`,
 * which commits, on this suite's own database copy (ADR 0124); the site-holder
 * read needs committed rows, because it runs on the superuser pool. `afterAll`
 * deletes every row the run tag names.
 *
 * Connection `"owner"`, as `pnpm db:seed` runs, so `FORCE ROW LEVEL SECURITY`,
 * `assets_rtu_id_location_id_fkey` (K4) and `locations_tree_guard` all bind.
 */

const ownerUrl = requireIntegrationDb({
  item: "F4.388",
  label: "the PHE seed splits a station into one site per RTU",
  because:
    "the one-statement move exists to satisfy a non-deferrable composite foreign key, the never-back " +
    "rule to survive a re-seed, and the holder skip to avoid a unique violation; only a real Postgres has them.",
  connection: "owner",
});

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type SeedPool = ReturnType<typeof createSeedPool>;
type SeedDb = ReturnType<typeof createDb>;
type Catalog = PhePilotSeed.PheCatalogFile;
type Outcome = PhePilotSeed.PheSeedOutcome;
type SkippedSite = Outcome["skippedSites"][number];

const RUN = randomUUID().slice(0, 8).toUpperCase();
const run = RUN.toLowerCase();
/** Edge RTU ids no real catalog uses: `int4`, distinct per station and RTU. */
const RTU_BASE = 1_000_000_000 + (parseInt(RUN.slice(0, 6), 16) % 1_000_000) * 100;

const real = loadPheCatalog();
const lotapataRows = real.rows.filter((row) => row.StationCode === "CBLTPT1");

/**
 * A copy of Lotapata (2 RTUs, 8 devices) under run-tagged identities. The
 * device codes keep their prefixes, so `deviceDomain` and `demoRoleForAsset`
 * see a meter, two pumps and an RTU-health unit per RTU.
 */
function syntheticStation(n: number): Catalog {
  const rtuIds = [...new Set(lotapataRows.map((row) => row.EdgeRTUId))];
  const stationCode = `T${RUN}${n}`;
  const stationName = `Split ${run} ${n}`;
  return {
    ...real,
    rows: lotapataRows.map((row) => {
      const index = rtuIds.indexOf(row.EdgeRTUId);
      const suffix = index === 0 ? "I" : "II";
      return {
        ...row,
        EdgeRTUId: RTU_BASE + n * 2 + index,
        RTUCode: `T${RUN}${n}${index}`,
        MqttTopic: `test/f4.388/${RUN}/${n}/${index}`,
        RTUDisplayName: `${stationName} ${suffix}`,
        StationId: 900_000 + n,
        StationCode: stationCode,
        StationName: stationName,
        DeviceId: 900_000 + n * 100 + row.DeviceId,
        DeviceCode: row.DeviceCode.replace(/-\d+$/, `-X${RUN}${n}${index}`),
      };
    }),
  };
}

function catalogOf(...stations: Catalog[]): Catalog {
  return { ...real, rows: stations.flatMap((station) => station.rows) };
}

const codeOf = (station: Catalog): string => station.rows[0]?.StationCode ?? "";
const slugOf = (station: Catalog): string => stationSlug(station.rows[0]?.StationName ?? "");
const sitesOf = (station: Catalog) => pheRtuSites(station);

describe.skipIf(!ownerUrl)("F4.388 — the PHE seed splits a station into one site per RTU", () => {
  let superPool: IntegrationPool | undefined;
  let seedPool: SeedPool | undefined;
  let seedDb: SeedDb | undefined;
  let phewbOrgId = "";
  let eskomOrgId = "";

  beforeAll(async () => {
    const url = ownerUrl as string;
    superPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F4.388");
    seedPool = createSeedPool(url);
    seedDb = createDb(seedPool);
    const orgs = await superPool.query<{ id: string; code: string }>(
      `SELECT id, code FROM bms.organizations WHERE code = ANY($1::varchar[])`,
      [["ESKOM", "PHEWB"]],
    );
    eskomOrgId = orgs.rows.find((row) => row.code === "ESKOM")?.id ?? "";
    phewbOrgId = orgs.rows.find((row) => row.code === "PHEWB")?.id ?? "";
    if (eskomOrgId === "" || phewbOrgId === "") throw new Error("ESKOM and PHEWB must be seeded — run pnpm db:seed.");
  }, 60_000);

  afterAll(async () => {
    if (superPool) await cleanUp(superPool);
    await seedPool?.end();
    await superPool?.end();
  }, 120_000);

  /** Deletes every row this run wrote, leaves first. */
  async function cleanUp(pool: IntegrationPool): Promise<void> {
    const assetIds = `SELECT id FROM bms.assets WHERE code LIKE '%-X${RUN}%'`;
    const locationIds = `SELECT id FROM bms.locations WHERE slug LIKE 'phe-split-${run}-%' OR code LIKE '%${RUN}%'`;
    await pool.query(`DELETE FROM bms.location_tariffs WHERE location_id IN (${locationIds})`);
    await pool.query(`DELETE FROM bms.asset_group_members WHERE asset_id IN (${assetIds})`);
    await pool.query(`DELETE FROM bms.asset_groups WHERE location_id IN (${locationIds})`);
    await pool.query(`DELETE FROM telemetry.point_values WHERE asset_id IN (${assetIds})`);
    await pool.query(`DELETE FROM bms.asset_points WHERE asset_id IN (${assetIds})`);
    await pool.query(`DELETE FROM bms.assets WHERE id IN (${assetIds})`);
    await pool.query(`DELETE FROM bms.rtus WHERE external_rtu_id BETWEEN $1 AND $2`, [RTU_BASE, RTU_BASE + 99]);
    // Deepest first: sites and holders, then stations, then the inactive root.
    for (let depth = 0; depth < 4; depth += 1) {
      await pool.query(
        `DELETE FROM bms.locations l WHERE l.id IN (${locationIds})
           AND NOT EXISTS (SELECT 1 FROM bms.locations c WHERE c.parent_id = l.id)`,
      );
    }
  }

  function pools(): { pool: SeedPool; db: SeedDb; superuser: IntegrationPool } {
    if (!seedPool || !seedDb || !superPool) throw new Error("pool not initialised");
    return { pool: seedPool, db: seedDb, superuser: superPool };
  }

  /** One seed run of `catalog` with `codes` on the list, committed as `seed.ts` does. */
  async function seed(catalog: Catalog, codes: readonly string[], lines: string[] = []): Promise<Outcome> {
    const { pool, db, superuser } = pools();
    return withOrganization(pool, phewbOrgId, () =>
      seedPheCatalog(db, pool, {
        catalog,
        splitStationCodes: codes,
        holderReader: superuser,
        log: (line) => lines.push(line),
      }),
    );
  }

  /** `readPhewbChecks` in PHEWB's context, rolled back; returns the failure lines. */
  async function gateFailures(
    catalog: Catalog,
    codes: readonly string[],
    skipped: readonly SkippedSite[] = [],
    lines: string[] = [],
  ): Promise<string[]> {
    const { pool } = pools();
    await pool.query("BEGIN");
    try {
      await pool.query("select set_config('app.current_organization', $1, true)", [phewbOrgId]);
      const checks = await readPhewbChecks(pool, hierarchyExpectations(catalog, codes), {
        pheSkippedSites: skipped,
        log: (line) => lines.push(line),
      });
      return failingChecks(checks);
    } finally {
      await pool.query("ROLLBACK");
    }
  }

  /**
   * The site-layout view count reads `phe_site_layout_views`, which Task 5
   * (PR 4) owns: these synthetic stations get no layout. Every other check is
   * PR 3's and must hold.
   */
  const notLayout = (lines: string[]): string[] =>
    lines.filter((line) => !line.startsWith("PHEWB catalog station site-layout view rows"));

  async function locationOf(slug: string): Promise<{
    id: string;
    parent_id: string | null;
    type: string;
    name: string;
    active: boolean;
    code: string;
    meta: unknown;
  }> {
    const res = await pools().superuser.query(
      `SELECT id, parent_id, type, name, active, code, meta FROM bms.locations WHERE slug = $1`,
      [slug],
    );
    const row = res.rows[0];
    if (!row) throw new Error(`no location ${slug}`);
    return row;
  }

  /** Each RTU's location slug and each asset's location slug and site_name, by edge RTU. */
  async function placement(catalog: Catalog): Promise<
    Map<number, { rtuAt: string; assets: { code: string; at: string; siteName: string }[] }>
  > {
    const ids = [...new Set(catalog.rows.map((row) => row.EdgeRTUId))];
    const rtus = await pools().superuser.query<{ external_rtu_id: number; slug: string; id: string }>(
      `SELECT r.external_rtu_id, l.slug, r.id FROM bms.rtus r JOIN bms.locations l ON l.id = r.location_id
        WHERE r.external_rtu_id = ANY($1::int[])`,
      [ids],
    );
    const assets = await pools().superuser.query<{ rtu_id: string; code: string; slug: string; site_name: string }>(
      `SELECT a.rtu_id, a.code, l.slug, a.site_name FROM bms.assets a JOIN bms.locations l ON l.id = a.location_id
        WHERE a.rtu_id = ANY($1::uuid[]) ORDER BY a.code`,
      [rtus.rows.map((row) => row.id)],
    );
    return new Map(
      rtus.rows.map((rtu) => [
        Number(rtu.external_rtu_id),
        {
          rtuAt: rtu.slug,
          assets: assets.rows
            .filter((asset) => asset.rtu_id === rtu.id)
            .map((asset) => ({ code: asset.code, at: asset.slug, siteName: asset.site_name })),
        },
      ]),
    );
  }

  /** PHEWB's rows of the five tables the split writes, ordered, without `updated_at`. */
  async function snapshot(): Promise<string> {
    const tables = ["locations", "rtus", "assets", "location_tariffs", "location_tariff_meters"];
    const parts: string[] = [];
    for (const table of tables) {
      const res = await pools().superuser.query<{ row: unknown }>(
        `SELECT to_jsonb(t) - 'updated_at' AS row FROM bms.${table} t
          WHERE t.organization_id = $1 ORDER BY to_jsonb(t)::text`,
        [phewbOrgId],
      );
      parts.push(`${table}:${JSON.stringify(res.rows.map((r) => r.row))}`);
    }
    return parts.join("\n");
  }

  async function groupSeed(): Promise<void> {
    const { pool } = pools();
    await withOrganization(pool, phewbOrgId, () => seedAssetGroups(pool, phewbOrgId));
  }

  // ── Station A (listed) and B (not listed): S1, S2, S10, S3, S6, S8, S4, S12 ──
  const A = syntheticStation(1);
  const B = syntheticStation(2);
  const AB = catalogOf(A, B);
  const [siteAI, siteAII] = sitesOf(A);
  let firstSplit: Outcome | undefined;
  let afterRun1 = "";
  const telemetryBefore = new Map<string, number>();

  async function telemetryCounts(): Promise<Map<string, number>> {
    const res = await pools().superuser.query<{ code: string; n: number }>(
      `SELECT a.code, count(pv.*)::int AS n FROM bms.assets a
         LEFT JOIN telemetry.point_values pv ON pv.asset_id = a.id
        WHERE a.code LIKE $1 GROUP BY a.code`,
      [`%-X${RUN}1%`],
    );
    return new Map(res.rows.map((row) => [row.code, row.n]));
  }

  it("S1 moves both RTUs of a listed station with their eight assets in one statement", async () => {
    await seed(AB, []);
    await groupSeed();
    const before = await placement(A);
    expect([...before.values()].map((p) => p.rtuAt)).toEqual([slugOf(A), slugOf(A)]);
    expect((await locationOf(slugOf(A))).type).toBe("pump_station");
    // S10's fixture: two samples per asset, written before the move.
    await pools().superuser.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value)
       SELECT t, a.id, 'kw', 1 FROM bms.assets a,
              unnest(ARRAY['2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z']::timestamptz[]) AS t
        WHERE a.code LIKE $1`,
      [`%-X${RUN}1%`],
    );
    for (const [code, n] of await telemetryCounts()) telemetryBefore.set(code, n);

    firstSplit = await seed(AB, [codeOf(A)]);

    expect([...firstSplit.movedExternalRtuIds].sort()).toEqual([siteAI?.edgeRtuId, siteAII?.edgeRtuId]);
    expect(firstSplit.movedAssets).toBe(8);
    expect(firstSplit.sites.map((site) => site.slug)).toEqual([siteAI?.slug, siteAII?.slug]);
    expect(firstSplit.skippedSites).toEqual([]);
    const station = await locationOf(slugOf(A));
    expect(station.type, "a split station is a campus (decision 2)").toBe("campus");
    for (const site of sitesOf(A)) {
      const row = await locationOf(site.slug);
      expect(row.parent_id).toBe(station.id);
      expect([row.type, row.name, row.code, row.active]).toEqual(["pump_station", site.name, site.code, true]);
      expect(row.meta).toMatchObject({ phe: { stationCode: site.stationCode, edgeRtuId: site.edgeRtuId } });
      const at = (await placement(A)).get(site.edgeRtuId);
      expect(at?.rtuAt).toBe(site.slug);
      expect(at?.assets.map((asset) => asset.at)).toEqual([site.slug, site.slug, site.slug, site.slug]);
    }
    const failures = await gateFailures(AB, [codeOf(A)]);
    expect(failures.filter((line) => line.startsWith("PHEWB asset/RTU location mismatch"))).toEqual([]);
    afterRun1 = await snapshot();
  }, 120_000);

  it("S2 control: moving one RTU without its assets raises 23503 on K4", async () => {
    const station = await locationOf(slugOf(A));
    // A checked-out client, not `pool.query`: pg-pool destroys the client a
    // failed `pool.query` ran on, which would end the transaction with it.
    const client = await pools().pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("select set_config('app.current_organization', $1, true)", [phewbOrgId]);
      await client.query("SAVEPOINT one_rtu");
      const error = await client
        .query(`UPDATE bms.rtus SET location_id = $1 WHERE external_rtu_id = $2`, [station.id, siteAI?.edgeRtuId])
        .then(
          () => undefined,
          (err: unknown) => err as { code?: string; constraint?: string },
        );
      await client.query("ROLLBACK TO SAVEPOINT one_rtu");
      expect(error?.code).toBe("23503");
      expect(error?.constraint).toBe("assets_rtu_id_location_id_fkey");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }, 60_000);

  it("S10 leaves every asset's telemetry rows where they were", async () => {
    expect(telemetryBefore.size).toBe(8);
    expect(await telemetryCounts()).toEqual(telemetryBefore);
  }, 60_000);

  it("S3 a second run with the same list moves nothing and changes no row", async () => {
    const outcome = await seed(AB, [codeOf(A)]);
    expect(outcome.movedExternalRtuIds, "D4 returns no row on run 2").toEqual([]);
    expect(outcome.movedAssets).toBe(0);
    expect(await snapshot()).toBe(afterRun1);
  }, 120_000);

  it("S6 the group seed empties the station's groups and fills each site's", async () => {
    await groupSeed();
    const res = await pools().superuser.query<{ slug: string; code: string; members: number; roled: number }>(
      `SELECT l.slug, g.code, count(m.asset_id)::int AS members, count(m.role)::int AS roled
         FROM bms.asset_groups g JOIN bms.locations l ON l.id = g.location_id
         LEFT JOIN bms.asset_group_members m ON m.asset_group_id = g.id
        WHERE l.slug = ANY($1::varchar[]) GROUP BY l.slug, g.code ORDER BY l.slug, g.code`,
      [[slugOf(A), siteAI?.slug, siteAII?.slug]],
    );
    const by = (slug: string | undefined) =>
      res.rows.filter((row) => row.slug === slug).map((row) => [row.code, row.members, row.roled]);
    expect(by(slugOf(A))).toEqual([
      ["electrical", 0, 0],
      ["environment", 0, 0],
      ["pump-station", 0, 0],
    ]);
    for (const site of [siteAI, siteAII]) {
      expect(by(site?.slug)).toEqual([
        ["electrical", 3, 3],
        ["environment", 1, 1],
        ["pump-station", 4, 4],
      ]);
    }
  }, 120_000);

  it("S8 a moved asset's site_name is its site's name; an unlisted station's is the catalog name", async () => {
    const placed = await placement(AB);
    for (const site of sitesOf(A)) {
      expect(placed.get(site.edgeRtuId)?.assets.map((asset) => asset.siteName)).toEqual(Array(4).fill(site.name));
    }
    const stationName = B.rows[0]?.StationName;
    for (const site of sitesOf(B)) {
      const at = placed.get(site.edgeRtuId);
      expect(at?.rtuAt).toBe(slugOf(B));
      expect(at?.assets.map((asset) => asset.siteName)).toEqual(Array(4).fill(stationName));
    }
    expect((await locationOf(slugOf(B))).type).toBe("pump_station");
  }, 60_000);

  it("S4 a run with the list emptied never moves an RTU back, and the gate holds", async () => {
    const outcome = await seed(AB, []);
    expect(outcome.movedExternalRtuIds).toEqual([]);
    const placed = await placement(A);
    for (const site of sitesOf(A)) {
      expect(placed.get(site.edgeRtuId)?.rtuAt).toBe(site.slug);
      expect(placed.get(site.edgeRtuId)?.assets.map((asset) => [asset.at, asset.siteName])).toEqual(
        Array(4).fill([site.slug, site.name]),
      );
    }
    expect(notLayout(await gateFailures(AB, []))).toEqual([]);
    expect(notLayout(await gateFailures(AB, [codeOf(A)]))).toEqual([]);
  }, 120_000);

  it("S12 the gate fails when a split RTU is back at its station", async () => {
    const station = await locationOf(slugOf(A));
    await pools().superuser.query(
      `WITH r AS (UPDATE bms.rtus SET location_id = $1 WHERE external_rtu_id = $2 RETURNING id, location_id)
       UPDATE bms.assets a SET location_id = r.location_id FROM r WHERE a.rtu_id = r.id`,
      [station.id, siteAI?.edgeRtuId],
    );
    const failures = await gateFailures(AB, [codeOf(A)]);
    expect(failures).toContain(`${PHE_SPLIT_RTUS_LABEL}: expected 2, got 1`);
    expect(failures).toContain(`${PHE_SPLIT_ASSETS_LABEL}: expected 8, got 4`);
    expect(failures.filter((line) => line.startsWith(PHE_SPLIT_SITES_LABEL))).toEqual([]);
    // The next seed with the station listed moves it to its site again.
    const outcome = await seed(AB, [codeOf(A)]);
    expect(outcome.movedExternalRtuIds).toEqual([siteAI?.edgeRtuId]);
    expect(notLayout(await gateFailures(AB, [codeOf(A)]))).toEqual([]);
  }, 120_000);

  // ── S5: holders (owner ruling Q2) ──
  it("S5 skips a site another row holds, logs it once, moves the other, and the gate rules per Q2", async () => {
    const C = syntheticStation(3);
    const D = syntheticStation(4);
    const E = syntheticStation(5);
    const CDE = catalogOf(C, D, E);
    await seed(CDE, []);
    const [cI] = sitesOf(C);
    const [dI] = sitesOf(D);
    const [eI] = sitesOf(E);
    if (!cI || !dI || !eI) throw new Error("a synthetic station has no RTU");
    const { superuser } = pools();
    const holder = (organizationId: string, code: string, slug: string) =>
      superuser.query<{ id: string }>(
        `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
         VALUES ($1, $2, $3, $4, 'plant', 0, 0) RETURNING id`,
        [organizationId, code, slug, `Holder ${slug}`],
      );
    // C: another organization holds the slug; D: a PHEWB row holds the code under
    // another slug; E: a PHEWB row holds the slug without the triple.
    await holder(eskomOrgId, `ESK-${RUN}-C`, cI.slug);
    await holder(phewbOrgId, dI.code, `phe-split-${run}-holder-d`);
    const eHolder = (await holder(phewbOrgId, `PHE-${RUN}-HOLDER-E`, eI.slug)).rows[0]?.id;

    const lines: string[] = [];
    const outcome = await seed(CDE, [codeOf(C), codeOf(D), codeOf(E)], lines);
    await groupSeed();

    expect(outcome.skippedSites.map((skip) => [skip.site.slug, skip.reason])).toEqual([
      [cI.slug, "foreign-slug"],
      [dI.slug, "code-holder"],
      [eI.slug, "phewb-slug"],
    ]);
    for (const site of [cI, dI, eI]) {
      expect(lines.filter((line) => line.includes(`skipped ${site.slug} `)), `one line for ${site.slug}`).toHaveLength(1);
    }
    const placed = await placement(CDE);
    for (const station of [C, D, E]) {
      const [one, two] = sitesOf(station);
      expect(placed.get(one?.edgeRtuId ?? 0)?.rtuAt, "the skipped site's RTU stays at the station").toBe(slugOf(station));
      expect(placed.get(two?.edgeRtuId ?? 0)?.rtuAt, "the other site still moves").toBe(two?.slug);
    }
    expect([...outcome.movedExternalRtuIds].sort()).toEqual(
      [C, D, E].map((station) => sitesOf(station)[1]?.edgeRtuId).sort(),
    );
    const notAdopted = await locationOf(eI.slug);
    expect([notAdopted.id, notAdopted.parent_id, notAdopted.meta]).toEqual([eHolder, null, null]);

    // The boot continues for C and D: each skip is exempted and logged.
    const CD = catalogOf(C, D);
    const cdSkips = outcome.skippedSites.filter((skip) => skip.reason !== "phewb-slug");
    const exemptions: string[] = [];
    const cd = await gateFailures(CD, [codeOf(C), codeOf(D)], cdSkips, exemptions);
    expect(notLayout(cd)).toEqual([]);
    expect(exemptions.filter((line) => line.includes("exempted"))).toHaveLength(2);
    // Fail-closed without the seed's list, as the CLI runs.
    expect(await gateFailures(CD, [codeOf(C), codeOf(D)])).toContain(`${PHE_SPLIT_SITES_LABEL}: expected 4, got 2`);

    // The boot stops for E, naming the row and the fix.
    const all = await gateFailures(CDE, [codeOf(C), codeOf(D), codeOf(E)], outcome.skippedSites);
    const shape = all.find((line) => line.startsWith(PHE_RTU_SLUG_SHAPE_LABEL));
    expect(shape).toContain(`${eI.slug} (id ${eHolder}`);
    expect(shape).toMatch(/fix: rename its slug$/);
    expect(all).toContain(`${PHE_SPLIT_SITES_LABEL}: expected 4, got 3`);
  }, 180_000);

  // ── S7: tariffs (decision 4a) ──
  it("S7 each moved site carries its station's tariff forward once", async () => {
    const F = syntheticStation(6);
    await seed(F, []);
    const { superuser } = pools();
    const station = await locationOf(slugOf(F));
    const meters = await superuser.query<{ code: string; id: string }>(
      `SELECT code, id FROM bms.assets WHERE code LIKE $1 ORDER BY code`,
      [`PHE-MFM-X${RUN}6%`],
    );
    const [mfmI, mfmII] = meters.rows.map((row) => row.id);
    if (!mfmI || !mfmII) throw new Error("station F has no two meters");
    const plant = async (from: string, to: string | null, billing: string, meterIds: string[]) => {
      const res = await superuser.query<{ id: string }>(
        `INSERT INTO bms.location_tariffs (organization_id, location_id, tariff_key, billing_meter_asset_id,
           sanctioned_load, sanctioned_load_unit, effective_from, effective_to)
         VALUES ($1, $2, 'test-f4388', $3, 50, 'kw', $4, $5) RETURNING id`,
        [phewbOrgId, station.id, billing, from, to],
      );
      const id = res.rows[0]?.id;
      await superuser.query(
        `INSERT INTO bms.location_tariff_meters (location_tariff_id, organization_id, asset_id)
         SELECT $1, $2, unnest($3::uuid[])`,
        [id, phewbOrgId, meterIds],
      );
    };
    // Both meters, billing meter RTU II's; and an older mapping with RTU I's meter only.
    await plant("2026-01-01", null, mfmII, [mfmI, mfmII]);
    await plant("2025-01-01", "2026-01-01", mfmI, [mfmI]);
    const stationRows = () =>
      superuser.query(
        `SELECT to_jsonb(lt) AS lt, (SELECT jsonb_agg(m ORDER BY m.asset_id) FROM bms.location_tariff_meters m
                                      WHERE m.location_tariff_id = lt.id) AS meters
           FROM bms.location_tariffs lt WHERE lt.location_id = $1 ORDER BY lt.effective_from`,
        [station.id],
      );
    const stationBefore = (await stationRows()).rows;
    const siteTariffs = async (slug: string | undefined) =>
      (
        await superuser.query<{ from: string; load: string; billing: string; meters: string[] }>(
          `SELECT to_char(lt.effective_from, 'YYYY-MM-DD') AS from, lt.sanctioned_load::text AS load,
                  lt.billing_meter_asset_id AS billing,
                  (SELECT array_agg(m.asset_id::text ORDER BY m.asset_id) FROM bms.location_tariff_meters m
                    WHERE m.location_tariff_id = lt.id) AS meters
             FROM bms.location_tariffs lt JOIN bms.locations l ON l.id = lt.location_id
            WHERE l.slug = $1 ORDER BY lt.effective_from`,
          [slug],
        )
      ).rows;
    const [fI, fII] = sitesOf(F);

    const lines: string[] = [];
    await seed(F, [codeOf(F)], lines);

    expect(await siteTariffs(fI?.slug)).toEqual([
      { from: "2025-01-01", load: "50.000", billing: mfmI, meters: [mfmI] },
      { from: "2026-01-01", load: "50.000", billing: mfmI, meters: [mfmI] },
    ]);
    // The older mapping has no meter at site II: not copied there.
    expect(await siteTariffs(fII?.slug)).toEqual([{ from: "2026-01-01", load: "50.000", billing: mfmII, meters: [mfmII] }]);
    expect((await stationRows()).rows, "the station's rows are unchanged").toEqual(stationBefore);
    expect(lines.filter((line) => line.includes("copied tariff"))).toHaveLength(3);

    // Run 2 copies nothing; an administrator's delete and edit are never undone.
    lines.length = 0;
    await seed(F, [codeOf(F)], lines);
    expect(lines.filter((line) => line.includes("copied tariff"))).toEqual([]);
    await superuser.query(
      `DELETE FROM bms.location_tariffs WHERE location_id = (SELECT id FROM bms.locations WHERE slug = $1)`,
      [fI?.slug],
    );
    await superuser.query(
      `UPDATE bms.location_tariffs SET sanctioned_load = 99
        WHERE location_id = (SELECT id FROM bms.locations WHERE slug = $1)`,
      [fII?.slug],
    );
    await seed(F, [codeOf(F)]);
    expect(await siteTariffs(fI?.slug)).toEqual([]);
    expect((await siteTariffs(fII?.slug)).map((row) => row.load)).toEqual(["99.000"]);

    // A site that had its own mapping before the move gets no copy.
    const G = syntheticStation(7);
    await seed(G, []);
    const gStation = await locationOf(slugOf(G));
    const [gI, gII] = sitesOf(G);
    if (!gI || !gII) throw new Error("station G has no two RTUs");
    const gMeters = await superuser.query<{ id: string }>(`SELECT id FROM bms.assets WHERE code LIKE $1 ORDER BY code`, [
      `PHE-MFM-X${RUN}7%`,
    ]);
    const [gMfmI, gMfmII] = gMeters.rows.map((row) => row.id);
    if (!gMfmI || !gMfmII) throw new Error("station G has no two meters");
    // Site II exists, shaped as the site, before its RTU moves: an administrator's row.
    const gSite = await superuser.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, parent_id, code, slug, name, type, latitude, longitude, meta)
       VALUES ($1, $2, $3, $4, $5, 'pump_station', 0, 0, $6::jsonb) RETURNING id`,
      [phewbOrgId, gStation.id, gII.code, gII.slug, gII.name, JSON.stringify({ phe: { stationCode: gII.stationCode, edgeRtuId: gII.edgeRtuId } })],
    );
    for (const [locationId, billing, ids] of [
      [gStation.id, gMfmII, [gMfmI, gMfmII]],
      [gSite.rows[0]?.id, gMfmII, [gMfmII]],
    ] as const) {
      const res = await superuser.query<{ id: string }>(
        `INSERT INTO bms.location_tariffs (organization_id, location_id, tariff_key, billing_meter_asset_id,
           sanctioned_load, sanctioned_load_unit, effective_from)
         VALUES ($1, $2, 'test-f4388', $3, 7, 'kw', '2026-01-01') RETURNING id`,
        [phewbOrgId, locationId, billing],
      );
      await superuser.query(
        `INSERT INTO bms.location_tariff_meters (location_tariff_id, organization_id, asset_id)
         SELECT $1, $2, unnest($3::uuid[])`,
        [res.rows[0]?.id, phewbOrgId, [...ids]],
      );
    }
    const gOutcome = await seed(G, [codeOf(G)]);
    expect([...gOutcome.movedExternalRtuIds].sort()).toEqual([gI.edgeRtuId, gII.edgeRtuId]);
    expect(gOutcome.sites.find((site) => site.slug === gII.slug)?.locationId, "adopted, not inserted").toBe(
      gSite.rows[0]?.id,
    );
    expect(await siteTariffs(gII.slug)).toEqual([{ from: "2026-01-01", load: "7.000", billing: gMfmII, meters: [gMfmII] }]);
    expect(await siteTariffs(gI.slug)).toEqual([{ from: "2026-01-01", load: "7.000", billing: gMfmI, meters: [gMfmI] }]);
  }, 240_000);

  // ── S9: the cold path ──
  it("S9 a station seeded cold with its code listed inserts its RTUs at their sites", async () => {
    const H = syntheticStation(8);
    const lines: string[] = [];
    const outcome = await seed(H, [codeOf(H)], lines);
    expect(outcome.movedExternalRtuIds, "nothing to move: every row is an insert").toEqual([]);
    expect(lines.filter((line) => line.includes("copied tariff"))).toEqual([]);
    expect((await locationOf(slugOf(H))).type).toBe("campus");
    const placed = await placement(H);
    for (const site of sitesOf(H)) {
      expect(placed.get(site.edgeRtuId)?.rtuAt).toBe(site.slug);
      expect(placed.get(site.edgeRtuId)?.assets.map((asset) => [asset.at, asset.siteName])).toEqual(
        Array(4).fill([site.slug, site.name]),
      );
    }
    const tariffs = await pools().superuser.query(
      `SELECT 1 FROM bms.location_tariffs lt JOIN bms.locations l ON l.id = lt.location_id
        WHERE l.slug = ANY($1::varchar[])`,
      [sitesOf(H).map((site) => site.slug)],
    );
    expect(tariffs.rowCount).toBe(0);
  }, 120_000);

  // ── S11: an inactive station ──
  it("S11 an inactive station's sites are written inactive and the seed does not raise", async () => {
    const K = syntheticStation(9);
    await seed(K, []);
    const { superuser } = pools();
    const station = await locationOf(slugOf(K));
    const root = await superuser.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
       VALUES ($1, $2, $3, $4, 'campus', 0, 0) RETURNING id`,
      [phewbOrgId, `PHE-${RUN}-ROOT`, `phe-split-${run}-root`, `Root ${run}`],
    );
    await superuser.query(`UPDATE bms.locations SET parent_id = $1 WHERE id = $2`, [root.rows[0]?.id, station.id]);
    // Bottom-up, as the tree guard requires.
    await superuser.query(`UPDATE bms.locations SET active = false WHERE id = $1`, [station.id]);
    await superuser.query(`UPDATE bms.locations SET active = false WHERE id = $1`, [root.rows[0]?.id]);

    const outcome = await seed(K, [codeOf(K)]);

    expect(outcome.movedExternalRtuIds).toHaveLength(2);
    expect((await locationOf(slugOf(K))).active).toBe(false);
    for (const site of sitesOf(K)) {
      const row = await locationOf(site.slug);
      expect([row.parent_id, row.active]).toEqual([station.id, false]);
    }
    // A second run re-asserts the sites under the inactive parent without raising.
    await seed(K, [codeOf(K)]);
  }, 120_000);
});
