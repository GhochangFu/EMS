import { randomUUID } from "node:crypto";

import type pg from "pg";

import type { PointAggregateResponse } from "@bms/shared";

import { resolveAggregateRange } from "./point-aggregate-window";
import { TelemetryService } from "./telemetry.service";

/**
 * `F4.297` (ADR 0108 decisions 1.2, 1.3 and 1.9) — `TelemetryService.pointAggregate`
 * against a real TimescaleDB: a custom `from`/`to`, the compare window's
 * buckets, per-bucket statistics, the `asset_id` containment and the site
 * zone. Until this suite the method had no database test.
 *
 * **The containment is the claim that matters.** `telemetry.*` carries no Row
 * Level Security, so the `asset_id` predicate in every fragment (`cur`,
 * `prev`, `bkt`, `pbkt`) is the only thing that keeps another asset's samples
 * out. {@link Fixtures.outsider} has samples on the same key in both the
 * current and the compare window, with values no planted sample of the asset
 * has (-500, 999); the absence claim sits beside a read of the outsider's own
 * id that sees them.
 *
 * **Fixture placement** is `point-stats.integration.spec.ts`'s: a fixed
 * far-future window ({@link BASE}) ahead of all four aggregates' watermarks,
 * so the real-time branch serves `_1m` from raw, no refresh is called, and
 * deleting the raw rows leaves nothing behind. The telemetry rows carry this
 * run's random asset ids; `telemetry.point_values` has no foreign key to
 * `bms.assets`, so the data asset has no `bms.*` row (its zone answers `UTC`).
 * `assertTheFixtureIsVisible` runs first and names the mechanism if the
 * assumption ever stops holding.
 *
 * **The zone fixtures are `bms.*` rows** — one per-run organization per
 * organization zone, a location per link and an asset on each — committed on
 * the superuser pool and deleted by id in {@link cleanup}. `bms.locations.timezone`
 * has no `CHECK` (migration 0075), so an invalid stored zone can be planted.
 */

const POINT_KEY = "f4297_point_aggregate_kw";
const MINUTE_MS = 60_000;

/** Far future, on a UTC midnight, so every 1-minute bucket starts on a whole minute from it. */
const BASE = new Date("2031-09-01T00:00:00.000Z");
/** The wall clock the retention guard reads: the fixture is in its future. */
const NOW = new Date();

const at = (minutes: number, seconds = 0): Date => new Date(BASE.getTime() + minutes * MINUTE_MS + seconds * 1_000);

/** The current window `[BASE+10 min, BASE+20 min)`; its compare window is `[BASE, BASE+10 min)`. */
const FROM = at(10);
const TO = at(20);

const OUTSIDER_CURRENT = -500;
const OUTSIDER_PREVIOUS = 999;
/** Planted exactly at `TO`: outside the half-open window. */
const AT_THE_END = 777;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export interface Fixtures {
  /**
   * Compare window: 100 at minute 2, 105 at minute 5. Current window: 1, 1, 1
   * and 4 in minute 12 (weighted mean 1.75, not the 2.5 of the distinct
   * values), 20 in minute 15. And 777 at minute 20, exactly at `TO`.
   */
  readonly asset: string;
  /** Same key: 999 at minute 3 (compare window), -500 at minute 12 (current window). Never passed except by the positive neighbour. */
  readonly outsider: string;
  /** Location `Asia/Kolkata` in an organization of `Europe/London`. */
  readonly zoneLocation: string;
  /** Location `NULL` in an organization of `Europe/London`. */
  readonly zoneOrganization: string;
  /** Location `NULL` in an organization of the column default `UTC`. */
  readonly zoneStoredUtc: string;
  /** Location `Not/AZone` (invalid, stored anyway) in an organization of `Europe/London`. */
  readonly zoneInvalidLocation: string;
  /** Every `bms.*` id this run wrote, for {@link cleanup}. */
  readonly organizations: readonly string[];
  readonly locations: readonly string[];
  readonly assets: readonly string[];
}

/**
 * Plants the telemetry rows on `pool` and the zone fixtures on `superPool`.
 * Ids are pushed into the arrays the moment each row exists, so a
 * `beforeAll` that fails half way is still cleaned.
 */
export async function setupFixtures(pool: pg.Pool, superPool: pg.Pool, written: Fixtures): Promise<Fixtures> {
  const samples: Array<[Date, string, number]> = [
    [at(2), written.asset, 100],
    [at(5), written.asset, 105],
    [at(12, 0), written.asset, 1],
    [at(12, 10), written.asset, 1],
    [at(12, 20), written.asset, 1],
    [at(12, 30), written.asset, 4],
    [at(15), written.asset, 20],
    [at(20), written.asset, AT_THE_END],
    [at(3), written.outsider, OUTSIDER_PREVIOUS],
    [at(12, 5), written.outsider, OUTSIDER_CURRENT],
  ];
  for (const [time, assetId, value] of samples) {
    await pool.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
       VALUES ($1, $2, $3, $4, 'kW')`,
      [time.toISOString(), assetId, POINT_KEY, value],
    );
  }

  const run = randomUUID().slice(0, 8);
  const organizations = written.organizations as string[];
  const locations = written.locations as string[];
  const assets = written.assets as string[];

  const organization = async (tag: string, timeZone: string | null): Promise<string> => {
    const code = `F4297-AGG-${run}-${tag}`;
    const { rows } = await superPool.query<{ id: string }>(
      timeZone === null
        ? `INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id`
        : `INSERT INTO bms.organizations (code, name, currency, timezone) VALUES ($1, $2, 'INR', $3) RETURNING id`,
      timeZone === null ? [code, `F4.297 ${code}`] : [code, `F4.297 ${code}`, timeZone],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error(`organization ${code} was not inserted`);
    organizations.push(id);
    return id;
  };

  const { rows: domainRows } = await superPool.query<{ code: string }>(
    "SELECT code FROM bms.asset_domains WHERE active = true ORDER BY code LIMIT 1",
  );
  const domain = domainRows[0]?.code;
  if (!domain) throw new Error("bms.asset_domains has no active row — run pnpm db:seed");

  const assetAt = async (tag: string, organizationId: string, locationZone: string | null): Promise<string> => {
    const code = `F4297-AGG-${run}-${tag}`;
    const { rows: locationRows } = await superPool.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, timezone)
       VALUES ($1, $2, $3, $4, 'campus', 0, 0, $5) RETURNING id`,
      [organizationId, code, code.toLowerCase(), `F4.297 ${tag}`, locationZone],
    );
    const locationId = locationRows[0]?.id;
    if (!locationId) throw new Error(`location ${code} was not inserted`);
    locations.push(locationId);
    const { rows: assetRows } = await superPool.query<{ id: string }>(
      `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
       VALUES ($1, $2, $3, $4, 'F4.297 site', $5) RETURNING id`,
      [organizationId, locationId, code, `F4.297 asset ${tag}`, domain],
    );
    const assetId = assetRows[0]?.id;
    if (!assetId) throw new Error(`asset ${code} was not inserted`);
    assets.push(assetId);
    return assetId;
  };

  const london = await organization("LON", "Europe/London");
  const storedUtc = await organization("UTC", null);
  return {
    ...written,
    zoneLocation: await assetAt("LOC", london, "Asia/Kolkata"),
    zoneOrganization: await assetAt("ORG", london, null),
    zoneStoredUtc: await assetAt("UTC", storedUtc, null),
    zoneInvalidLocation: await assetAt("BAD", london, "Not/AZone"),
  };
}

/** The ids before any row is written: two random telemetry asset ids and empty `bms.*` lists. */
export function emptyFixtures(): Fixtures {
  return {
    asset: randomUUID(),
    outsider: randomUUID(),
    zoneLocation: "",
    zoneOrganization: "",
    zoneStoredUtc: "",
    zoneInvalidLocation: "",
    organizations: [],
    locations: [],
    assets: [],
  };
}

/** Deletes this run's rows by constant id lists, children of every foreign key first. */
export async function cleanup(pool: pg.Pool, superPool: pg.Pool | undefined, fx: Fixtures | undefined): Promise<void> {
  if (!fx) return;
  await pool.query(`DELETE FROM telemetry.point_values WHERE asset_id = ANY($1::uuid[])`, [[fx.asset, fx.outsider]]);
  if (!superPool) return;
  await superPool.query(`DELETE FROM bms.assets WHERE id = ANY($1::uuid[])`, [fx.assets]);
  await superPool.query(`DELETE FROM bms.locations WHERE id = ANY($1::uuid[])`, [fx.locations]);
  await superPool.query(`DELETE FROM bms.organizations WHERE id = ANY($1::uuid[])`, [fx.organizations]);
}

/**
 * `pool` is the fleet pool for both slots: the telemetry reads need no
 * organization context, and the zone read is a fleet read in production too.
 */
function service(pool: pg.Pool): TelemetryService {
  return new TelemetryService(null as never, pool, pool);
}

/** The route's path: the query's custom pair resolved by `resolveAggregateRange`, then the service. */
function read(
  pool: pg.Pool,
  assetId: string,
  options: { compare?: boolean; bucketStats?: boolean; bucketFunction?: "avg" } = {},
): Promise<PointAggregateResponse> {
  const range = resolveAggregateRange({ from: FROM.toISOString(), to: TO.toISOString() }, NOW);
  return service(pool).pointAggregate(
    { assetId, pointKey: POINT_KEY },
    {
      ...range,
      compare: options.compare ?? false,
      bucketFunction: options.bucketFunction ?? "avg",
      bucketStats: options.bucketStats ?? false,
      now: NOW,
    },
  );
}

const minuteOf = (iso: string): number => (new Date(iso).getTime() - BASE.getTime()) / MINUTE_MS;

function bucketAt(buckets: PointAggregateResponse["buckets"], minute: number) {
  const bucket = (buckets ?? []).find((b) => minuteOf(b.t) === minute);
  if (!bucket) throw new Error(`no bucket at minute ${minute}: ${JSON.stringify(buckets)}`);
  return bucket;
}

/** The fixture reaches the `1m` level through the real-time branch (else every claim below is vacuous). */
export async function assertTheFixtureIsVisible(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const { rows } = await pool.query<{ n: string }>(
    "SELECT count(*) AS n FROM telemetry.point_values_1m WHERE asset_id = ANY($1::uuid[]) AND point_key = $2",
    [[fx.asset, fx.outsider], POINT_KEY],
  );
  assert(
    Number(rows[0]?.n) === 7,
    `expected 7 minute buckets for the fixture, got ${rows[0]?.n}. The real-time branch no longer serves a ` +
      "far-future window from raw, so every claim in this suite would read nothing.",
  );
}

/**
 * `[BASE+10 min, BASE+20 min)` reads exactly its ten 1-minute buckets,
 * gap-filled, minute 10 to minute 19; `from`/`to` are echoed and the level is
 * `1m`. The 777 planted exactly at `to` is in no bucket. Mutation: read
 * `time <= to` → an eleventh bucket (minute 20) appears; drop `fillBucketGaps`
 * → two buckets.
 */
export async function assertACustomRangeReadsExactlyItsBuckets(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const answer = await read(pool, fx.asset);
  assert(answer.from === FROM.toISOString() && answer.to === TO.toISOString(), `from/to must be echoed, got ${answer.from}..${answer.to}`);
  assert(answer.bucketSeconds === 60, `a 10-minute range reads the 1m level, got ${answer.bucketSeconds}`);
  const minutes = (answer.buckets ?? []).map((b) => minuteOf(b.t));
  assert(
    JSON.stringify(minutes) === JSON.stringify([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]),
    `expected the ten buckets minute 10..19, got ${JSON.stringify(minutes)}`,
  );
  assert(bucketAt(answer.buckets, 12).v === 1.75, `minute 12's avg must be 1.75, got ${bucketAt(answer.buckets, 12).v}`);
  assert(bucketAt(answer.buckets, 15).v === 20, `minute 15's avg must be 20, got ${bucketAt(answer.buckets, 15).v}`);
  assert(bucketAt(answer.buckets, 11).v === null, `an empty minute is a gap (null), got ${bucketAt(answer.buckets, 11).v}`);
  assert(answer.stats.max === 20, `the 777 at the window's end must not be the max, got ${answer.stats.max}`);
}

/**
 * The compare window is the equal-length period before `from`, and its
 * buckets are that period's samples at their true timestamps (100 at minute
 * 2, 105 at minute 5). Mutation: read `pbkt` at `$3, $4` instead of `$5, $6`
 * → the compare buckets equal the current ones and minute 2 is missing.
 */
export async function assertCompareBucketsCoverThePrecedingPeriod(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const answer = await read(pool, fx.asset, { compare: true });
  const compare = answer.compare;
  assert(compare !== null, "a compare request must answer a compare object");
  assert(
    compare?.from === BASE.toISOString() && compare.to === FROM.toISOString(),
    `the compare window must be [from - span, from), got ${compare?.from}..${compare?.to}`,
  );
  const previous = compare?.buckets ?? [];
  assert(previous.length === (answer.buckets ?? []).length, `compare must have as many buckets as current, got ${previous.length}`);
  const minutes = previous.map((b) => minuteOf(b.t));
  assert(
    JSON.stringify(minutes) === JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    `compare buckets must carry true timestamps minute 0..9, got ${JSON.stringify(minutes)}`,
  );
  assert(bucketAt(previous, 2).v === 100 && bucketAt(previous, 5).v === 105, `compare must hold 100 and 105, got ${JSON.stringify(previous)}`);
  assert(compare?.stats.max === 105, `the compare stats must be the earlier period's, got ${compare?.stats.max}`);
}

/**
 * With `bucketStats`, a bucket carries min, the weighted mean, max and the
 * sample count: minute 12 (1, 1, 1, 4) is 1 / 1.75 / 4 over 4 (the ADR 0023
 * trap: not 2.5). An empty minute is null statistics over 0 samples.
 * Mutation: average `avg_value` per row unweighted, or drop the stats columns.
 */
export async function assertBucketStatsCarryMinAverageMax(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const answer = await read(pool, fx.asset, { bucketStats: true });
  const full = bucketAt(answer.buckets, 12);
  assert(
    full.min === 1 && full.average === 1.75 && full.max === 4 && full.sampleCount === 4,
    `minute 12 must be 1/1.75/4 over 4, got ${JSON.stringify(full)}`,
  );
  const empty = bucketAt(answer.buckets, 11);
  assert(
    empty.min === null && empty.average === null && empty.max === null && empty.sampleCount === 0,
    `an empty minute must be null statistics over 0 samples, got ${JSON.stringify(empty)}`,
  );
}

/** Without `bucketStats` the buckets carry `t` and `v` only (the widget path). */
export async function assertBucketsWithoutStatsCarryNoStatistics(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const answer = await read(pool, fx.asset);
  const keys = Object.keys(bucketAt(answer.buckets, 12)).sort();
  assert(JSON.stringify(keys) === JSON.stringify(["t", "v"]), `a bucket without bucketStats must be {t, v}, got ${JSON.stringify(keys)}`);
}

/**
 * The containment: another asset's samples on the same key are in no
 * statistic and no bucket, current or compare — beside a read of the
 * outsider's own id that sees its -500 and 999. Mutation: drop `asset_id`
 * from any one fragment.
 */
export async function assertAnOutsiderOnTheSameKeyIsNotRead(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const seen = await read(pool, fx.outsider, { compare: true, bucketStats: true });
  assert(seen.stats.min === OUTSIDER_CURRENT, `the positive neighbour must see the outsider's -500, got ${seen.stats.min}`);
  assert(
    bucketAt(seen.compare?.buckets ?? null, 3).v === OUTSIDER_PREVIOUS,
    `the positive neighbour must see the outsider's 999 in its compare buckets, got ${JSON.stringify(seen.compare?.buckets)}`,
  );

  const answer = await read(pool, fx.asset, { compare: true, bucketStats: true });
  const values = [
    answer.stats.min,
    answer.stats.max,
    answer.compare?.stats.min,
    answer.compare?.stats.max,
    ...[...(answer.buckets ?? []), ...(answer.compare?.buckets ?? [])].flatMap((b) => [b.v, b.min, b.max]),
  ];
  assert(
    !values.includes(OUTSIDER_CURRENT) && !values.includes(OUTSIDER_PREVIOUS),
    `an outsider's sample reached the answer: ${JSON.stringify(values)}`,
  );
  assert(bucketAt(answer.buckets, 12).sampleCount === 4, `minute 12 must count the asset's 4 samples only, got ${bucketAt(answer.buckets, 12).sampleCount}`);
}

async function zoneOf(pool: pg.Pool, assetId: string): Promise<string | undefined> {
  return (await read(pool, assetId)).timeZone;
}

/** A location with a valid stored zone wins over its organization's. Mutation: read the organization first. */
export async function assertTheLocationZoneWins(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const zone = await zoneOf(pool, fx.zoneLocation);
  assert(zone === "Asia/Kolkata", `the location's zone must win, got ${zone}`);
}

/** A location with no zone falls to its organization's. Mutation: answer `UTC` when the location is NULL. */
export async function assertANullLocationFallsToTheOrganization(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const zone = await zoneOf(pool, fx.zoneOrganization);
  assert(zone === "Europe/London", `a NULL location must fall to the organization's zone, got ${zone}`);
}

/** An organization on the column default reports the stored name `UTC`, not `Etc/UTC`. Mutation: report `arithmeticZone`. */
export async function assertAStoredUtcIsReportedAsUtc(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const zone = await zoneOf(pool, fx.zoneStoredUtc);
  assert(zone === "UTC", `a stored UTC must be reported as UTC, got ${zone}`);
}

/**
 * An invalid stored location zone falls to the organization's and the read
 * still answers (no 500; ADR 0108 decision 2.8). Mutation: report the stored
 * location value unchecked → `Not/AZone`.
 */
export async function assertAnInvalidLocationZoneFallsToTheOrganization(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const zone = await zoneOf(pool, fx.zoneInvalidLocation);
  assert(zone === "Europe/London", `an invalid location zone must fall to the organization's, got ${zone}`);
}
