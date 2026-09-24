import { randomUUID } from "node:crypto";

import type pg from "pg";

import { latestPueRatio } from "../telemetry/pue-ratio";
import { DashboardService } from "./dashboard.service";
import { priorInstant, priorOpenAlarms, priorTotalKw, readKpiPrior } from "./kpi-prior";

/**
 * `F3.28` — the KPI prior reads (ADR 0074 decision 5, the owner's ruling OQ2)
 * against a real database. The instant arithmetic is `kpi-prior.spec.ts`.
 *
 * **Every case runs in its own transaction and rolls it back.** The wrapper
 * checks out one client, issues `BEGIN`, seeds a fresh organization, location
 * and asset, runs the case, and issues `ROLLBACK` in a `finally` — so a case
 * that returns normally leaves nothing behind, and no case needs a `DELETE` on
 * `telemetry.point_values` (the `tests/adr-0024-retention-bounds.test.ts`
 * hazard) or a sweep of a code prefix (`tests/integration-fixture-isolation`).
 * `now()` is frozen at `BEGIN`, which only the live PUE case reads, and it
 * stamps its samples a minute before the wall clock.
 *
 * **The instants are wall-clock, not far-future.** `T` is the current second
 * and `at = priorInstant(T)`; every sample is placed relative to those, so the
 * rows land in recent, uncompressed chunks. The `kw` row "at T − 24 h" is
 * stamped with the **same** `Date` passed as `at`, because the `time <= $2` →
 * `time < $2` mutation only reddens on an exact boundary hit.
 */

const RUN_CODE = `F328-KPI-${randomUUID()}`;
const HOUR_MS = 3_600_000;
const SECOND_MS = 1_000;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export interface Seeded {
  readonly organizationId: string;
  readonly assetId: string;
  /** The response's `asOf`, to the second. */
  readonly now: Date;
  /** `priorInstant(now)`. */
  readonly at: Date;
}

/**
 * Runs `fn` inside a transaction on one checked-out client and always rolls it
 * back. Not named `withRollback`: that name is the Drizzle helper the
 * `tests/f3.60-withrollback-cases-roll-back.test.ts` gate counts.
 */
export async function inRolledBackTransaction(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

/** A fresh organization, location and asset, inside the caller's transaction. */
export async function seedAsset(client: pg.PoolClient): Promise<Seeded> {
  const tag = `${RUN_CODE}-${randomUUID().slice(0, 8)}`;
  const domain = await client.query<{ code: string }>(
    "SELECT code FROM bms.asset_domains ORDER BY code LIMIT 1",
  );
  const domainCode = domain.rows[0]?.code;
  if (!domainCode) {
    throw new Error("bms.asset_domains is empty — run pnpm db:migrate && pnpm db:seed first");
  }
  const org = await client.query<{ id: string }>(
    "INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'ZAR') RETURNING id",
    [`${tag}-ORG`, "F3.28 KPI prior fixture organization"],
  );
  const organizationId = org.rows[0]?.id;
  if (!organizationId) throw new Error("failed to insert the F3.28 fixture organization");
  const loc = await client.query<{ id: string }>(
    `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
     VALUES ($1, $2, $3, $4, 'site', 0, 0) RETURNING id`,
    [organizationId, `${tag}-LOC`, `f328-kpi-${tag.toLowerCase()}`, "F3.28 KPI prior fixture site"],
  );
  const locationId = loc.rows[0]?.id;
  if (!locationId) throw new Error("failed to insert the F3.28 fixture location");
  const asset = await client.query<{ id: string }>(
    `INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, domain)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [organizationId, `${tag}-AST`, "F3.28 fixture asset", "F3.28 fixture site", locationId, domainCode],
  );
  const assetId = asset.rows[0]?.id;
  if (!assetId) throw new Error("failed to insert the F3.28 fixture asset");
  const now = new Date(Math.floor(Date.now() / SECOND_MS) * SECOND_MS);
  return { organizationId, assetId, now, at: priorInstant(now) };
}

async function insertSample(
  client: pg.PoolClient,
  assetId: string,
  pointKey: string,
  time: Date,
  value: number,
): Promise<void> {
  await client.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
     VALUES ($1::timestamptz, $2, $3, $4, 'kW')`,
    [time.toISOString(), assetId, pointKey, value],
  );
}

async function insertAlarm(
  client: pg.PoolClient,
  s: Seeded,
  raisedAt: Date,
  clearedAt: Date | null,
): Promise<void> {
  const severity = await client.query<{ code: string }>(
    "SELECT code FROM bms.alarm_severities ORDER BY code LIMIT 1",
  );
  const code = severity.rows[0]?.code;
  if (!code) throw new Error("bms.alarm_severities is empty — run pnpm db:seed first");
  await client.query(
    `INSERT INTO bms.alarms (organization_id, asset_id, severity, message, raised_at, cleared_at)
     VALUES ($1, $2, $3, 'F3.28 KPI prior fixture alarm', $4::timestamptz, $5::timestamptz)`,
    [s.organizationId, s.assetId, code, raisedAt.toISOString(), clearedAt?.toISOString() ?? null],
  );
}

const hoursBefore = (t: Date, h: number): Date => new Date(t.getTime() - h * HOUR_MS);
const secondsFrom = (t: Date, s: number): Date => new Date(t.getTime() + s * SECOND_MS);

/**
 * kw at T−25h = 5, at T−24h = 6 (exactly `at`), T−23h = 7, now = 9 → 6.
 * `time < $2` answers 5; dropping the bound answers 9.
 */
export async function assertPriorKwIsTheLatestSampleAtOrBeforeAt(client: pg.PoolClient): Promise<void> {
  const s = await seedAsset(client);
  await insertSample(client, s.assetId, "kw", hoursBefore(s.now, 25), 5);
  await insertSample(client, s.assetId, "kw", s.at, 6);
  await insertSample(client, s.assetId, "kw", hoursBefore(s.now, 23), 7);
  await insertSample(client, s.assetId, "kw", s.now, 9);
  const got = await priorTotalKw(client, [s.assetId], s.at);
  assert(got === 6, `expected the sample stamped exactly at T − 24 h (6), got ${JSON.stringify(got)}`);
}

/** Only T−23h and now exist → `null`, never 0. Dropping the bound answers 9. */
export async function assertPriorKwIsNullWithNoSampleAtOrBeforeAt(client: pg.PoolClient): Promise<void> {
  const s = await seedAsset(client);
  await insertSample(client, s.assetId, "kw", hoursBefore(s.now, 23), 7);
  await insertSample(client, s.assetId, "kw", s.now, 9);
  const got = await priorTotalKw(client, [s.assetId], s.at);
  assert(got === null, `no kw at or before T − 24 h must be null, got ${JSON.stringify(got)}`);
}

export async function assertAlarmRaisedBeforeAndUnclearedIsCounted(client: pg.PoolClient): Promise<void> {
  const s = await seedAsset(client);
  await insertAlarm(client, s, hoursBefore(s.now, 30), null);
  const got = await priorOpenAlarms(client, [s.assetId], s.at);
  assert(got === 1, `an alarm raised T − 30 h and never cleared was open at T − 24 h, got ${got}`);
}

export async function assertAlarmClearedBeforeAtIsNotCounted(client: pg.PoolClient): Promise<void> {
  const s = await seedAsset(client);
  await insertAlarm(client, s, hoursBefore(s.now, 30), hoursBefore(s.now, 25));
  const got = await priorOpenAlarms(client, [s.assetId], s.at);
  assert(got === 0, `an alarm cleared T − 25 h was not open at T − 24 h, got ${got}`);
}

export async function assertAlarmRaisedAfterAtIsNotCounted(client: pg.PoolClient): Promise<void> {
  const s = await seedAsset(client);
  await insertAlarm(client, s, hoursBefore(s.now, 23), null);
  const got = await priorOpenAlarms(client, [s.assetId], s.at);
  assert(got === 0, `an alarm raised T − 23 h did not exist at T − 24 h, got ${got}`);
}

/** The `cleared_at IS NULL`-only mutation answers 0 here. */
export async function assertAlarmClearedAfterAtIsCounted(client: pg.PoolClient): Promise<void> {
  const s = await seedAsset(client);
  await insertAlarm(client, s, hoursBefore(s.now, 30), hoursBefore(s.now, 23));
  const got = await priorOpenAlarms(client, [s.assetId], s.at);
  assert(got === 1, `an alarm raised T − 30 h and cleared T − 23 h was open at T − 24 h, got ${got}`);
}

/** A pair 60 s before `at` is inside `(at − 900 s, at]`: 60 / 30 = 2. */
export async function assertPriorPueReadsAPairInsideTheWindow(client: pg.PoolClient): Promise<void> {
  const s = await seedAsset(client);
  await insertSample(client, s.assetId, "site_kw", secondsFrom(s.at, -60), 60);
  await insertSample(client, s.assetId, "it_kw", secondsFrom(s.at, -60), 30);
  const got = await latestPueRatio(client, [s.assetId], s.at);
  assert(got === 2, `a pair inside (at − 900 s, at] must read 60 / 30 = 2, got ${JSON.stringify(got)}`);
}

/** A pair only after `at` is outside the prior window. Dropping the ceiling answers 2. */
export async function assertPriorPueIgnoresAPairAfterAt(client: pg.PoolClient): Promise<void> {
  const s = await seedAsset(client);
  await insertSample(client, s.assetId, "site_kw", secondsFrom(s.at, 60), 60);
  await insertSample(client, s.assetId, "it_kw", secondsFrom(s.at, 60), 30);
  const got = await latestPueRatio(client, [s.assetId], s.at);
  assert(got === null, `a pair stamped after at must not count, got ${JSON.stringify(got)}`);
}

/** A pair only older than `at − 900 s` is outside the prior window too. */
export async function assertPriorPueIgnoresAPairOlderThanTheWindow(client: pg.PoolClient): Promise<void> {
  const s = await seedAsset(client);
  await insertSample(client, s.assetId, "site_kw", secondsFrom(s.at, -1_200), 60);
  await insertSample(client, s.assetId, "it_kw", secondsFrom(s.at, -1_200), 30);
  const got = await latestPueRatio(client, [s.assetId], s.at);
  assert(got === null, `a pair 1200 s before at is outside the 900 s window, got ${JSON.stringify(got)}`);
}

/**
 * The composition `DashboardService.kpis` ships: every field from its own read,
 * all at `at`. Each field has a distinct value, and a live PUE pair (90 / 30 =
 * 3) sits beside the prior one (60 / 30 = 2), so dropping `at` from the
 * `latestPueRatio` call — which tsc cannot see, the parameter being optional —
 * answers 3, and swapping two same-typed fields cannot pass either.
 */
export async function assertComposedPriorReadsEveryFieldAtAt(client: pg.PoolClient): Promise<void> {
  const s = await seedAsset(client);
  await insertSample(client, s.assetId, "kw", s.at, 6);
  await insertSample(client, s.assetId, "kw", s.now, 9);
  await insertSample(client, s.assetId, "site_kw", secondsFrom(s.at, -60), 60);
  await insertSample(client, s.assetId, "it_kw", secondsFrom(s.at, -60), 30);
  const fresh = new Date(Date.now() - 60 * SECOND_MS);
  await insertSample(client, s.assetId, "site_kw", fresh, 90);
  await insertSample(client, s.assetId, "it_kw", fresh, 30);
  await insertAlarm(client, s, hoursBefore(s.now, 30), hoursBefore(s.now, 23));
  const got = await readKpiPrior(client, [s.assetId], s.at);
  const expected = { asOf: s.at.toISOString(), totalKw: 6, alarmsOpen: 1, pueEstimate: 2 };
  assert(
    JSON.stringify(got) === JSON.stringify(expected),
    `readKpiPrior must read every field at at: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`,
  );
}

// ---------------------------------------------------------------------------
// `DashboardService.kpis()` → `prior`: the composition the endpoint ships, and
// its scope boundary on the BYPASSRLS `FLEET_POOL`.
// ---------------------------------------------------------------------------

/**
 * `E4.1c` — the tariff resolver the service takes. Nothing here reads cost, so
 * every asset resolves to no tariff (as `dashboard.integration.spec.ts` does).
 */
const NO_TARIFFS = { resolveForAssets: async () => new Map<string, number>() };

interface ScopeFixture {
  /** The in-scope asset — the only id handed to `kpis` / `priorTotalKw`. */
  readonly a: Seeded;
  /** The out-of-scope asset. Only its ids are used; its `now`/`at` are not. */
  readonly b: Seeded;
  /** `priorInstant(t0)`, for the direct reads. */
  readonly at: Date;
}

/**
 * Two assets, one clock. `t0` is captured once, after both assets are seeded
 * and just before the caller reads, and every sample is placed relative to it
 * with margin — `kpis()` takes its own `now` a few milliseconds later, so its
 * `prior` instant lands inside every window below with ~60 s to spare.
 *
 * Every figure is distinct, so no mutation can pass by coincidence:
 *
 * | | A (in scope) | B (out of scope) |
 * |---|---|---|
 * | `kw` at t0 − 24 h − 60 s | 6 | 100 |
 * | `kw` at t0 − 5 s (live) | 9 | — |
 * | PUE pair at t0 − 24 h − 120 s | 60 / 30 = 2 | 300 / 30 (mixed: 360 / 60 = 6) |
 * | PUE pair at t0 − 60 s (live) | 90 / 30 = 3 | — |
 * | alarm | raised t0 − 30 h, cleared t0 − 23 h (open at `at`, not now) | raised t0 − 30 h, never cleared |
 *
 * The `kpis` reads run on the checked-out client, as a `bms_fleet`
 * (`BYPASSRLS`) connection — the production pool's role — so no RLS policy
 * hides B and the `$1` scope is the only thing that can.
 */
async function seedScopeFixture(client: pg.PoolClient): Promise<ScopeFixture> {
  const a = await seedAsset(client);
  const b = await seedAsset(client);
  const t0 = new Date();
  const priorKwAt = new Date(t0.getTime() - 24 * HOUR_MS - 60 * SECOND_MS);
  const priorPueAt = new Date(t0.getTime() - 24 * HOUR_MS - 120 * SECOND_MS);
  await insertSample(client, a.assetId, "kw", priorKwAt, 6);
  await insertSample(client, a.assetId, "kw", secondsFrom(t0, -5), 9);
  await insertSample(client, a.assetId, "site_kw", priorPueAt, 60);
  await insertSample(client, a.assetId, "it_kw", priorPueAt, 30);
  await insertSample(client, a.assetId, "site_kw", secondsFrom(t0, -60), 90);
  await insertSample(client, a.assetId, "it_kw", secondsFrom(t0, -60), 30);
  await insertAlarm(client, a, hoursBefore(t0, 30), hoursBefore(t0, 23));
  await insertSample(client, b.assetId, "kw", priorKwAt, 100);
  await insertSample(client, b.assetId, "site_kw", priorPueAt, 300);
  await insertSample(client, b.assetId, "it_kw", priorPueAt, 30);
  await insertAlarm(client, b, hoursBefore(t0, 30), null);
  return { a, b, at: priorInstant(t0) };
}

async function kpisForA(client: pg.PoolClient) {
  const f = await seedScopeFixture(client);
  const service = new DashboardService(client as unknown as pg.Pool, NO_TARIFFS);
  return { f, kpis: await service.kpis([f.a.assetId]) };
}

/** `prior.asOf` is exactly 24 h before the response's own `asOf`. */
export async function assertKpisPriorAsOfIsExactly24HoursBeforeAsOf(client: pg.PoolClient): Promise<void> {
  const { kpis } = await kpisForA(client);
  const gap = Date.parse(kpis.asOf) - Date.parse(kpis.prior.asOf);
  assert(
    gap === 86_400_000,
    `prior.asOf must be asOf − 86 400 000 ms, got a gap of ${gap} ms (asOf ${kpis.asOf}, prior.asOf ${kpis.prior.asOf})`,
  );
}

/** `prior.totalKw` is A's own prior `kw` (6) — not B's 100 added, not A's live 9. */
export async function assertKpisPriorTotalKwIsTheInScopeAssetsOwn(client: pg.PoolClient): Promise<void> {
  const { kpis } = await kpisForA(client);
  assert(
    kpis.prior.totalKw === 6,
    `prior.totalKw must be the in-scope asset's own prior kw (6), got ${JSON.stringify(kpis.prior.totalKw)}`,
  );
}

/**
 * `prior.alarmsOpen` counts A's alarm (open at `at`) and not B's. 1 is both the
 * positive control (A's is counted) and the exclusion (B's would make it 2).
 */
export async function assertKpisPriorAlarmsOpenExcludesTheOutOfScopeAlarm(client: pg.PoolClient): Promise<void> {
  const { kpis } = await kpisForA(client);
  assert(
    kpis.prior.alarmsOpen === 1,
    `prior.alarmsOpen must count only the in-scope alarm open at at (1), got ${kpis.prior.alarmsOpen}`,
  );
}

/** `prior.pueEstimate` is A's own ratio (2) — B's pair would make it 6. */
export async function assertKpisPriorPueExcludesTheOutOfScopePair(client: pg.PoolClient): Promise<void> {
  const { kpis } = await kpisForA(client);
  assert(
    kpis.prior.pueEstimate === 2,
    `prior.pueEstimate must be the in-scope pair's own ratio (2), got ${JSON.stringify(kpis.prior.pueEstimate)}`,
  );
}

/** `priorTotalKw` scoped to [A] reads A's 6 and not A + B's 106. */
export async function assertPriorTotalKwScopedExcludesTheOutOfScopeAsset(client: pg.PoolClient): Promise<void> {
  const f = await seedScopeFixture(client);
  const got = await priorTotalKw(client, [f.a.assetId], f.at);
  assert(got === 6, `priorTotalKw([A]) must exclude B's kw (6, not 106), got ${JSON.stringify(got)}`);
}

/** Without `at` the live read is unchanged: a pair a minute old reads 2. */
export async function assertLivePueStillReadsAFreshPair(client: pg.PoolClient): Promise<void> {
  const s = await seedAsset(client);
  const fresh = new Date(Date.now() - 60 * SECOND_MS);
  await insertSample(client, s.assetId, "site_kw", fresh, 60);
  await insertSample(client, s.assetId, "it_kw", fresh, 30);
  const got = await latestPueRatio(client, [s.assetId]);
  assert(got === 2, `the live read must still see a pair 60 s old, got ${JSON.stringify(got)}`);
}
