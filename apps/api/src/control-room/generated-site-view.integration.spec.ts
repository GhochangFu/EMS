import { randomUUID } from "node:crypto";

import { NotFoundException } from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import type { GeneratedSiteViewDto } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import { GeneratedSiteViewService } from "./generated-site-view.service";
import { jwtFor } from "./site-control-room-view.integration.spec";

/**
 * `F3.68` (ADR 0076 decision 7, plan U5, R1–R15) — `GeneratedSiteViewService`
 * against a real database. The sibling `.integration.test.ts` owns the pools;
 * the assertions live here (ADR 0014, AGENTS.md §4.6).
 *
 * **Two harnesses.**
 *
 * - **`read()` cases (R1–R10, R14, R15) run in one transaction and roll it back.**
 *   The test file wraps each in `inRolledBackTransaction` (`BEGIN` … `ROLLBACK`
 *   in a `finally`), and the service is constructed over that same client, so
 *   it sees the fixture rows — per-run organization, location, domains, point
 *   keys, assets, points and samples — and nobody else does. Nothing commits.
 * - **`forUser()` cases (R11–R13) read seeded rows only** — `RSMOC-WC`, a
 *   seeded PHEWB site, the seeded users — and write nothing, so there is
 *   nothing to clean up.
 *
 * **One clock.** SQL `now()` is frozen at `BEGIN`. Every sample is stamped
 * `now() - make_interval(secs => N)`, and `read()` is handed that same
 * `now()` (read back as a JS `Date`, whose millisecond truncation matches the
 * sample's, because N is whole seconds), so every age is exact — including
 * the 25.000 s boundary of R8d.
 */

const RUN = randomUUID().slice(0, 8);

export const NOT_FOUND = "Location not found or outside your access scope";

interface Site {
  readonly organizationId: string;
  readonly locationId: string;
  readonly domainCode: string;
  readonly tag: string;
}

/** A `pg.Pool`-shaped wrapper over one client that counts `query` calls (R9). */
export function countingClient(client: pg.PoolClient): { pool: pg.Pool; count: () => number } {
  let calls = 0;
  const pool = {
    query: (...args: unknown[]) => {
      calls += 1;
      return (client.query as (...a: unknown[]) => unknown)(...args);
    },
  } as unknown as pg.Pool;
  return { pool, count: () => calls };
}

function readService(pool: pg.Pool): GeneratedSiteViewService {
  // `read()` never touches access control; the `forUser` cases build the real one.
  return new GeneratedSiteViewService(pool, {} as AccessControlService);
}

/** The transaction's frozen `now()`, as JS reads it. */
async function txNowMs(client: pg.PoolClient): Promise<number> {
  const { rows } = await client.query<{ now: Date }>("SELECT now() AS now");
  const now = rows[0]?.now;
  if (!now) throw new Error("SELECT now() returned no row");
  return now.getTime();
}

/** A per-case organization and active location, inside the caller's transaction. */
async function seedSite(client: pg.PoolClient): Promise<Site> {
  const tag = `F368-${RUN}-${randomUUID().slice(0, 8)}`;
  const domain = await client.query<{ code: string }>(
    "SELECT code FROM bms.asset_domains ORDER BY sort_order, code LIMIT 1",
  );
  const domainCode = domain.rows[0]?.code;
  if (!domainCode) {
    throw new Error("bms.asset_domains is empty — run pnpm db:migrate && pnpm db:seed first");
  }
  const org = await client.query<{ id: string }>(
    "INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'ZAR') RETURNING id",
    [`${tag}-ORG`, "F3.68 generated-view fixture organization"],
  );
  const organizationId = org.rows[0]?.id;
  if (!organizationId) throw new Error("failed to insert the F3.68 fixture organization");
  const loc = await client.query<{ id: string }>(
    `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, active)
     VALUES ($1, $2, $3, $4, 'site', 0, 0, true) RETURNING id`,
    [organizationId, `${tag}-LOC`, tag.toLowerCase(), "F3.68 generated-view fixture site"],
  );
  const locationId = loc.rows[0]?.id;
  if (!locationId) throw new Error("failed to insert the F3.68 fixture location");
  return { organizationId, locationId, domainCode, tag };
}

/** A per-case asset domain with its own `sort_order`. */
async function seedDomain(client: pg.PoolClient, site: Site, suffix: string, sortOrder: number): Promise<string> {
  const code = `${site.tag}-${suffix}`.toLowerCase();
  await client.query(
    "INSERT INTO bms.asset_domains (code, label, sort_order) VALUES ($1, $2, $3)",
    [code, `F3.68 ${suffix}`, sortOrder],
  );
  return code;
}

/** One gateway-less asset at the site (no `template_id`). */
async function seedAsset(client: pg.PoolClient, site: Site, domain: string = site.domainCode): Promise<string> {
  const asset = await client.query<{ id: string }>(
    `INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, domain)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      site.organizationId,
      `${site.tag}-${randomUUID().slice(0, 8)}`,
      "F3.68 generated-view fixture asset",
      `${site.tag} site`,
      site.locationId,
      domain,
    ],
  );
  const id = asset.rows[0]?.id;
  if (!id) throw new Error("failed to insert the F3.68 fixture asset");
  return id;
}

/** A per-case catalog point key `f368_<run>_<case>_<suffix>`; returns its code. */
async function seedPointKey(
  client: pg.PoolClient,
  site: Site,
  suffix: string,
  opts: { rank?: number | null; unit?: string | null } = {},
): Promise<string> {
  const code = `f368_${site.tag.slice(-8)}_${suffix}`;
  await client.query(
    `INSERT INTO bms.point_keys (code, name, unit, headline_rank, active)
     VALUES ($1, $2, $3, $4, true)`,
    [code, `F3.68 ${suffix}`, opts.unit ?? null, opts.rank ?? null],
  );
  return code;
}

/** One `bms.asset_points` row of `assetId` on `pointKey`. */
async function seedAssetPoint(
  client: pg.PoolClient,
  site: Site,
  assetId: string,
  pointKey: string,
  opts: { unit?: string | null; active?: boolean; source?: string } = {},
): Promise<void> {
  await client.query(
    `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key, unit, active)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      site.organizationId,
      assetId,
      pointKey,
      opts.source ?? `src_${pointKey}`,
      opts.unit ?? null,
      opts.active ?? true,
    ],
  );
}

/** A sample `ageSeconds` before the transaction's frozen `now()`. */
async function insertSample(
  client: pg.PoolClient,
  assetId: string,
  pointKey: string,
  value: number,
  ageSeconds: number,
): Promise<void> {
  await client.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
     VALUES (now() - make_interval(secs => $4), $1, $2, $3, 'u')`,
    [assetId, pointKey, value, ageSeconds],
  );
}

async function readAll(client: pg.PoolClient, site: Site, assetIds: string[] | null = null): Promise<GeneratedSiteViewDto> {
  return readService(client as unknown as pg.Pool).read(site.locationId, assetIds, await txNowMs(client));
}

function assetOf(dto: GeneratedSiteViewDto, assetId: string) {
  const asset = dto.domains.flatMap((d) => d.assets).find((a) => a.id === assetId);
  if (!asset) throw new Error(`asset ${assetId} is absent from the generated view`);
  return asset;
}

const assetIdsOf = (dto: GeneratedSiteViewDto): string[] => dto.domains.flatMap((d) => d.assets.map((a) => a.id));

/** One asset with one registered point `k` and a sample `ageSeconds` old. */
async function assetWithSampleAged(client: pg.PoolClient, ageSeconds: number | null) {
  const site = await seedSite(client);
  const asset = await seedAsset(client, site);
  const key = await seedPointKey(client, site, "k");
  await seedAssetPoint(client, site, asset, key);
  if (ageSeconds !== null) {
    await insertSample(client, asset, key, 1, ageSeconds);
  }
  return assetOf(await readAll(client, site), asset);
}

// ---------------------------------------------------------------- read() cases

/**
 * R1 — two assets in two domains answer two panels in `sort_order`. The
 * domain sorted second by `sort_order` sorts first by code and its asset is
 * inserted first, so neither a dropped `ORDER BY` nor an order by code can
 * pass.
 */
export async function assertDomainsInSortOrder(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const first = await seedDomain(client, site, "a", 2);
  const second = await seedDomain(client, site, "b", 1);
  await seedAsset(client, site, first);
  await seedAsset(client, site, second);
  const dto = await readAll(client, site);
  expect(dto.domains.map((d) => d.code)).toEqual([second, first]);
}

/** R2 — ranks 2, 1, NULL, NULL on keys d, c, b, a order c, d, a, b. */
export async function assertRankThenNullsLast(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const asset = await seedAsset(client, site);
  const a = await seedPointKey(client, site, "a");
  const b = await seedPointKey(client, site, "b");
  const c = await seedPointKey(client, site, "c", { rank: 1 });
  const d = await seedPointKey(client, site, "d", { rank: 2 });
  for (const key of [a, b, c, d]) await seedAssetPoint(client, site, asset, key);
  const got = assetOf(await readAll(client, site), asset).points.map((p) => p.pointKey);
  expect(got).toEqual([c, d, a, b]);
}

/**
 * R3 — an equal rank on aa, mm and zz orders them by key: only the SQL
 * `point_key ASC` tiebreak owns this rule (the service never re-sorts).
 *
 * **Why the tiebreak survived deletion, and the fixture now.** Without the
 * tiebreak the ties come out in the order the final sort receives them
 * (Postgres's sort keeps an already-ordered run), and that order belongs to
 * the plan, which the planner picks from table statistics. Measured on
 * `bms_f368` with the mutated statement: the planner joins `latest` with a
 * **Merge Left Join on `(asset_id, point_key)`**, so it first sorts the
 * `asset_points` rows by `(asset_id, point_key)` — key order — and the
 * incremental sort on `headline_rank` then keeps that order. The `DISTINCT ON`
 * join, not the service, placed the ties correctly. Under another plan
 * (nested loop over a bitmap heap scan, seen on an earlier run) the ties come
 * out in heap order and the deletion reddens. Other key-ordered paths: an
 * index scan on the `(asset_id, point_key)` unique index, and — with the old
 * fixture's `src_<point_key>` — an index scan on
 * `asset_points_asset_source_key_idx`.
 *
 * So this transaction switches off merge and hash joins and index scans,
 * which leaves a nested loop with `asset_points` as the outer side, read by
 * a bitmap heap or seq scan in heap order. The points are inserted mm, zz, aa
 * (neither key order nor its reverse) with `source_data_key`s that sort zz,
 * aa, mm. The only thing left that can put aa, mm, zz in key order is the SQL
 * tiebreak itself, which is the layer that owns the rule.
 */
export async function assertTieOrdersByKey(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const asset = await seedAsset(client, site);
  const aa = await seedPointKey(client, site, "aa", { rank: 5 });
  const mm = await seedPointKey(client, site, "mm", { rank: 5 });
  const zz = await seedPointKey(client, site, "zz", { rank: 5 });
  await seedAssetPoint(client, site, asset, mm, { source: "src_3" });
  await seedAssetPoint(client, site, asset, zz, { source: "src_1" });
  await seedAssetPoint(client, site, asset, aa, { source: "src_2" });
  for (const knob of ["enable_mergejoin", "enable_hashjoin", "enable_indexscan", "enable_indexonlyscan"]) {
    await client.query(`SET LOCAL ${knob} = off`);
  }
  const got = assetOf(await readAll(client, site), asset).points.map((p) => p.pointKey);
  expect(got).toEqual([aa, mm, zz]);
}

/** R4 — an asset with no ranked point lists its points by key. */
export async function assertUnrankedOrdersByKey(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const asset = await seedAsset(client, site);
  const c = await seedPointKey(client, site, "c");
  const a = await seedPointKey(client, site, "a");
  const b = await seedPointKey(client, site, "b");
  for (const key of [c, a, b]) await seedAssetPoint(client, site, asset, key);
  const got = assetOf(await readAll(client, site), asset).points.map((p) => p.pointKey);
  expect(got).toEqual([a, b, c]);
}

/** R5a — of two samples, `latest` is the newer. */
export async function assertLatestIsTheNewerSample(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const asset = await seedAsset(client, site);
  const key = await seedPointKey(client, site, "x");
  await seedAssetPoint(client, site, asset, key);
  await insertSample(client, asset, key, 11, 120);
  await insertSample(client, asset, key, 22, 60);
  const point = assetOf(await readAll(client, site), asset).points.find((p) => p.pointKey === key);
  expect(point?.latest?.value).toBe(22);
}

/** R5b — a registered point with no sample answers `latest: null`. */
export async function assertNoSampleIsNullLatest(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const asset = await seedAsset(client, site);
  const key = await seedPointKey(client, site, "y");
  await seedAssetPoint(client, site, asset, key);
  const point = assetOf(await readAll(client, site), asset).points.find((p) => p.pointKey === key);
  expect(point, "the registered point must be listed").toBeDefined();
  expect(point?.latest).toBeNull();
}

/** R6 — an inactive `asset_points` row is absent; its active sibling (positive control) is present. */
export async function assertInactivePointIsAbsent(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const asset = await seedAsset(client, site);
  const on = await seedPointKey(client, site, "on");
  const off = await seedPointKey(client, site, "off");
  await seedAssetPoint(client, site, asset, on);
  await seedAssetPoint(client, site, asset, off, { active: false });
  const keys = assetOf(await readAll(client, site), asset).points.map((p) => p.pointKey);
  expect(keys, "positive control: the active sibling").toContain(on);
  expect(keys).not.toContain(off);
}

/** R7a — the asset point's unit overrides the catalog's. */
export async function assertUnitOverrideWins(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const asset = await seedAsset(client, site);
  const key = await seedPointKey(client, site, "u", { unit: "catalog" });
  await seedAssetPoint(client, site, asset, key, { unit: "override" });
  const point = assetOf(await readAll(client, site), asset).points.find((p) => p.pointKey === key);
  expect(point?.unit).toBe("override");
}

/** R7b — the catalog unit fills an asset point with none. */
export async function assertCatalogUnitFillsNull(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const asset = await seedAsset(client, site);
  const key = await seedPointKey(client, site, "v", { unit: "catalog" });
  await seedAssetPoint(client, site, asset, key);
  const point = assetOf(await readAll(client, site), asset).points.find((p) => p.pointKey === key);
  expect(point?.unit).toBe("catalog");
}

/** R8a — a newest sample 22 s old is `live`. */
export async function assertTwentyTwoSecondsIsLive(client: pg.PoolClient): Promise<void> {
  expect((await assetWithSampleAged(client, 22)).freshness).toBe("live");
}

/** R8b — a newest sample 30 s old is `stale`. */
export async function assertThirtySecondsIsStale(client: pg.PoolClient): Promise<void> {
  expect((await assetWithSampleAged(client, 30)).freshness).toBe("stale");
}

/** R8c — no sample is `none`, with a null `latestTelemetryAt`. */
export async function assertNoSampleIsNone(client: pg.PoolClient): Promise<void> {
  const asset = await assetWithSampleAged(client, null);
  expect([asset.freshness, asset.latestTelemetryAt]).toEqual(["none", null]);
}

/** R8d — exactly 25 s is still `live`: the window is inclusive. */
export async function assertTheBoundaryIsLive(client: pg.PoolClient): Promise<void> {
  expect((await assetWithSampleAged(client, 25)).freshness).toBe("live");
}

/**
 * Two assets at one site for R15. Each has the registered active point `k`.
 * The control has a sample on `k` 5 s old. The subject has a sample on `k`
 * 60 s old, and a 5 s sample on the point that `unregistered` names:
 *
 * - `"catalog-only"`: a catalog key with no `asset_points` row for the asset;
 * - `"inactive"`: a key mapped to the asset with `active = false`.
 */
async function freshSampleOnAPointThatDoesNotCount(
  client: pg.PoolClient,
  unregistered: "catalog-only" | "inactive",
) {
  const site = await seedSite(client);
  const control = await seedAsset(client, site);
  const subject = await seedAsset(client, site);
  const k = await seedPointKey(client, site, "k");
  const other = await seedPointKey(client, site, "other");
  await seedAssetPoint(client, site, control, k);
  await seedAssetPoint(client, site, subject, k);
  if (unregistered === "inactive") {
    await seedAssetPoint(client, site, subject, other, { active: false });
  }
  await insertSample(client, control, k, 1, 5);
  await insertSample(client, subject, k, 1, 60);
  await insertSample(client, subject, other, 1, 5);
  const dto = await readAll(client, site);
  return { control: assetOf(dto, control), subject: assetOf(dto, subject) };
}

/**
 * R15a (D3) — a fresh sample on a point the asset has no mapping for does not
 * make it live. Positive control first: a fresh sample on a registered point does.
 */
export async function assertUnregisteredSampleDoesNotMakeLive(client: pg.PoolClient): Promise<void> {
  const { control, subject } = await freshSampleOnAPointThatDoesNotCount(client, "catalog-only");
  expect(control.freshness, "positive control: a 5 s sample on a registered point is live").toBe("live");
  expect(subject.freshness).toBe("stale");
}

/**
 * R15b (D3) — a fresh sample on an inactive mapping does not make the asset
 * live. Positive control first, as R15a.
 */
export async function assertInactiveMappingSampleDoesNotMakeLive(client: pg.PoolClient): Promise<void> {
  const { control, subject } = await freshSampleOnAPointThatDoesNotCount(client, "inactive");
  expect(control.freshness, "positive control: a 5 s sample on a registered point is live").toBe("live");
  expect(subject.freshness).toBe("stale");
}

/** R9a — `assetIds = [a]` answers only `a`, in exactly two statements. */
export async function assertAssetIdsNarrowTheRead(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const a = await seedAsset(client, site);
  await seedAsset(client, site);
  const nowMs = await txNowMs(client);
  const spy = countingClient(client);
  const dto = await readService(spy.pool).read(site.locationId, [a], nowMs);
  expect({ ids: assetIdsOf(dto), queries: spy.count() }).toEqual({ ids: [a], queries: 2 });
}

/** R9b — `assetIds = []` answers `{ domains: [] }` and sends no query. */
export async function assertEmptyScopeSendsNoQuery(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  await seedAsset(client, site);
  const nowMs = await txNowMs(client);
  const spy = countingClient(client);
  const dto = await readService(spy.pool).read(site.locationId, [], nowMs);
  expect({ dto, queries: spy.count() }).toEqual({
    dto: { locationId: site.locationId, asOf: new Date(nowMs).toISOString(), domains: [] },
    queries: 0,
  });
}

/** R9c — three assets with points still cost two statements (D4: no N+1). */
export async function assertThreeAssetsCostTwoStatements(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const key = await seedPointKey(client, site, "n");
  for (let i = 0; i < 3; i += 1) {
    const asset = await seedAsset(client, site);
    await seedAssetPoint(client, site, asset, key);
    await insertSample(client, asset, key, i, 5);
  }
  const nowMs = await txNowMs(client);
  const spy = countingClient(client);
  const dto = await readService(spy.pool).read(site.locationId, null, nowMs);
  expect({ assets: assetIdsOf(dto).length, queries: spy.count() }).toEqual({ assets: 3, queries: 2 });
}

/** R10 — no fixture asset has a `template_id`, and every one is answered. */
export async function assertTemplatelessAssetsAreAnswered(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const ids = [await seedAsset(client, site), await seedAsset(client, site)];
  const { rows } = await client.query<{ id: string; template_id: string | null }>(
    "SELECT id, template_id FROM bms.assets WHERE location_id = $1 ORDER BY id",
    [site.locationId],
  );
  const dto = await readAll(client, site);
  expect({
    templates: rows.map((r) => r.template_id),
    answered: [...assetIdsOf(dto)].sort(),
  }).toEqual({ templates: [null, null], answered: [...ids].sort() });
}

/** R14 — a location id that does not exist is the F3.67 404, even unscoped. */
export async function assertUnknownLocationIsNotFound(client: pg.PoolClient): Promise<void> {
  const nowMs = await txNowMs(client);
  const read = readService(client as unknown as pg.Pool).read(randomUUID(), null, nowMs);
  await expect(read).rejects.toThrow(new NotFoundException(NOT_FOUND));
}

// ------------------------------------------------------------- forUser() cases

export type ForUserCtx = {
  svc: GeneratedSiteViewService;
  fleetPool: pg.Pool;
  rsmocWcId: string;
  pheSiteId: string;
};

async function siteAssetIds(ctx: ForUserCtx, locationId: string): Promise<string[]> {
  const { rows } = await ctx.fleetPool.query<{ id: string }>(
    "SELECT id FROM bms.assets WHERE location_id = $1 ORDER BY id",
    [locationId],
  );
  return rows.map((r) => r.id);
}

/** The RSMOC-WC assets in a group `wc-hvac-admin` is granted, read as `bms_fleet`. */
async function hvacMemberIds(ctx: ForUserCtx): Promise<string[]> {
  const { rows } = await ctx.fleetPool.query<{ id: string }>(
    `SELECT DISTINCT a.id
       FROM bms.assets a
       JOIN bms.asset_group_members m ON m.asset_id = a.id
       JOIN bms.user_asset_group_access g ON g.asset_group_id = m.asset_group_id
       JOIN bms.users u ON u.id = g.user_id
      WHERE u.email = 'wc-hvac-admin@bms.local' AND a.location_id = $1
      ORDER BY a.id`,
    [ctx.rsmocWcId],
  );
  return rows.map((r) => r.id);
}

const sorted = (ids: string[]): string[] => [...ids].sort();

/**
 * R11 — `phe-admin` reads a PHEWB site whole (positive control, run first),
 * then gets the F3.67 404 on the ESKOM site `RSMOC-WC`.
 */
export async function assertOrganizationAdminIsBoundToItsOrganization(ctx: ForUserCtx): Promise<void> {
  const pheAdmin = jwtFor("phe-admin@bms.local", "organization_admin");
  const expected = await siteAssetIds(ctx, ctx.pheSiteId);
  expect(expected.length, "the PHEWB site must hold assets for the control to mean anything").toBeGreaterThan(0);
  const own = await ctx.svc.forUser(pheAdmin, ctx.pheSiteId);
  expect(sorted(assetIdsOf(own)), "positive control: every asset at the PHEWB site").toEqual(expected);

  await expect(ctx.svc.forUser(pheAdmin, ctx.rsmocWcId)).rejects.toThrow(new NotFoundException(NOT_FOUND));
}

/** R12a — `wc-hvac-admin` on `RSMOC-WC` gets at least one asset, and exactly its group members. */
export async function assertAssetGroupAdminGetsItsMembers(ctx: ForUserCtx): Promise<void> {
  const members = await hvacMemberIds(ctx);
  expect(members.length, "wc-hvac-admin must be granted at least one RSMOC-WC asset").toBeGreaterThan(0);
  const dto = await ctx.svc.forUser(jwtFor("wc-hvac-admin@bms.local", "asset_group_admin"), ctx.rsmocWcId);
  expect(sorted(assetIdsOf(dto))).toEqual(members);
}

/** R12b — an RSMOC-WC asset outside every granted group (positive control: it exists) is absent. */
export async function assertAssetGroupAdminMissesANonMember(ctx: ForUserCtx): Promise<void> {
  const members = new Set(await hvacMemberIds(ctx));
  const outsider = (await siteAssetIds(ctx, ctx.rsmocWcId)).find((id) => !members.has(id));
  expect(outsider, "positive control: RSMOC-WC must hold an asset outside the granted groups").toBeDefined();
  const dto = await ctx.svc.forUser(jwtFor("wc-hvac-admin@bms.local", "asset_group_admin"), ctx.rsmocWcId);
  expect(assetIdsOf(dto)).not.toContain(outsider);
}

/** R13 — the global `admin` reads a PHEWB site, every asset. */
export async function assertGlobalAdminReadsAPhewbSite(ctx: ForUserCtx): Promise<void> {
  const expected = await siteAssetIds(ctx, ctx.pheSiteId);
  const dto = await ctx.svc.forUser(jwtFor("admin@bms.local", "admin"), ctx.pheSiteId);
  expect({ locationId: dto.locationId, ids: sorted(assetIdsOf(dto)) }).toEqual({
    locationId: ctx.pheSiteId,
    ids: expected,
  });
}
