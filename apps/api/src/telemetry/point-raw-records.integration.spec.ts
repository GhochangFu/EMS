import { randomUUID } from "node:crypto";

import type pg from "pg";

import { encodePointRef } from "@bms/shared";

import { TelemetryService } from "./telemetry.service";

/**
 * `F4.297` (ADR 0108 decision 1.6) — `TelemetryService.pointRawRecords` against
 * a real TimescaleDB: newest first with `deviceTime`, the `before` keyset
 * cursor, and the `asset_id` containment.
 *
 * **The containment is the claim that matters.** `telemetry.*` carries no Row
 * Level Security, so the `asset_id = $1` predicate is the only thing that keeps
 * another asset's samples on the same point key out of the page.
 * {@link Fixtures.outsider} has rows on the same key, interleaved in time with
 * the asset under test; if the predicate is dropped they show up in the page.
 * The absence claim sits beside the positive reads that pass it.
 *
 * **Fixture placement** is `point-stats.integration.spec.ts`'s: a fixed
 * far-future window ({@link BASE}), raw rows only, this run's random asset ids
 * (`telemetry.point_values` has no foreign key to `bms.assets`), removed by id
 * list in `cleanup`. The read is raw, so no aggregate is involved; every call
 * passes a `now` past the fixture, because the newest page is bounded by
 * `time < now`.
 */

const POINT_KEY = "f4297_raw_records_kw";
const MINUTE_MS = 60_000;

const BASE = new Date("2031-08-01T00:00:00.000Z");
/** The read's upper bound when no `before` is given: one day past the fixture. */
const NOW = new Date(BASE.getTime() + 86_400_000);

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export interface Fixtures {
  /** Five samples at minutes 0..4, values 10..14; minute 4 carries a device time, the rest NULL. */
  readonly asset: string;
  /** Same key, minutes 0.5..4.5 (interleaved), values 900+. Never passed. */
  readonly outsider: string;
}

const at = (minutes: number): Date => new Date(BASE.getTime() + minutes * MINUTE_MS);
/** The device's own clock on the newest row: 7 seconds behind `time`. */
const DEVICE_TIME = new Date(at(4).getTime() - 7_000);

export async function setupFixtures(pool: pg.Pool): Promise<Fixtures> {
  const fx: Fixtures = { asset: randomUUID(), outsider: randomUUID() };
  for (let minute = 0; minute < 5; minute += 1) {
    await pool.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit, device_time)
       VALUES ($1, $2, $3, $4, 'kW', $5)`,
      [at(minute).toISOString(), fx.asset, POINT_KEY, 10 + minute, minute === 4 ? DEVICE_TIME.toISOString() : null],
    );
    await pool.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
       VALUES ($1, $2, $3, $4, 'kW')`,
      [at(minute + 0.5).toISOString(), fx.outsider, POINT_KEY, 900 + minute],
    );
  }
  return fx;
}

/** Deletes this run's rows by a constant list of ids (`tests/adr-0024-retention-bounds.test.ts`). */
export async function cleanup(pool: pg.Pool, fx: Fixtures | undefined): Promise<void> {
  if (!fx) return;
  await pool.query(`DELETE FROM telemetry.point_values WHERE asset_id = ANY($1::uuid[])`, [[fx.asset, fx.outsider]]);
}

function service(pool: pg.Pool): TelemetryService {
  // The drizzle and fleet slots are unused by the raw read.
  return new TelemetryService(null as never, pool, null as never);
}

function read(pool: pg.Pool, assetId: string, limit: number, before?: Date) {
  return service(pool).pointRawRecords({ assetId, pointKey: POINT_KEY }, { limit, before, now: NOW });
}

/**
 * Newest first, and `deviceTime` is the stored device clock as an ISO instant
 * or `null`. Mutation: `ORDER BY time ASC` → the first item is minute 0;
 * drop `device_time` from the select → the first item's `deviceTime` is null.
 */
export async function assertNewestFirstWithDeviceTime(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const page = await read(pool, fx.asset, 10);
  assert(page.pointRef === encodePointRef(fx.asset, POINT_KEY), `pointRef must name the point, got ${page.pointRef}`);
  assert(
    JSON.stringify(page.items.map((i) => i.value)) === JSON.stringify([14, 13, 12, 11, 10]),
    `expected values newest first [14..10], got ${JSON.stringify(page.items.map((i) => i.value))}`,
  );
  assert(page.items[0]?.time === at(4).toISOString(), `the first item must be minute 4, got ${page.items[0]?.time}`);
  assert(
    page.items[0]?.deviceTime === DEVICE_TIME.toISOString(),
    `the newest row's deviceTime must be its stored device clock, got ${String(page.items[0]?.deviceTime)}`,
  );
  assert(page.items[1]?.deviceTime === null, `a NULL device_time must be null, got ${String(page.items[1]?.deviceTime)}`);
  assert(page.items[0]?.unit === "kW", `the unit must come back, got ${String(page.items[0]?.unit)}`);
  assert(page.nextBefore === null, `a page holding every row must have no next cursor, got ${String(page.nextBefore)}`);
}

/**
 * Limit 2 over five rows: three pages, no overlap and no gap. Page 1's
 * `nextBefore` is its 2nd row's time; page 2 starts strictly before it; the
 * last page's `nextBefore` is `null`. Mutation: `time <= $3` → page 2 repeats
 * minute 3; drop the plus-one row → a full last page reports a cursor.
 */
export async function assertTheCursorPagesWithoutOverlapOrGap(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const page1 = await read(pool, fx.asset, 2);
  assert(page1.items.length === 2, `page 1 must hold 2 items, got ${page1.items.length}`);
  assert(page1.nextBefore === at(3).toISOString(), `page 1's cursor must be its 2nd row's time, got ${String(page1.nextBefore)}`);

  const page2 = await read(pool, fx.asset, 2, new Date(page1.nextBefore as string));
  assert(
    JSON.stringify(page2.items.map((i) => i.value)) === JSON.stringify([12, 11]),
    `page 2 must start strictly before the cursor, got ${JSON.stringify(page2.items.map((i) => i.value))}`,
  );
  assert(page2.nextBefore === at(1).toISOString(), `page 2's cursor must be minute 1, got ${String(page2.nextBefore)}`);

  const page3 = await read(pool, fx.asset, 2, new Date(page2.nextBefore as string));
  assert(
    JSON.stringify(page3.items.map((i) => i.value)) === JSON.stringify([10]),
    `the last page must hold minute 0 only, got ${JSON.stringify(page3.items.map((i) => i.value))}`,
  );
  assert(page3.nextBefore === null, `the last page must have no cursor, got ${String(page3.nextBefore)}`);
}

/**
 * A page that ends exactly at the last row is the last page: limit 5 over five
 * rows has no cursor. The plus-one row tells "more" from "at the bound".
 * Mutation: set `nextBefore` whenever `items.length === limit` → reddens.
 */
export async function assertAPageAtTheBoundHasNoCursor(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const page = await read(pool, fx.asset, 5);
  assert(page.items.length === 5, `expected 5 items, got ${page.items.length}`);
  assert(page.nextBefore === null, `a page that ends at the last row must have no cursor, got ${String(page.nextBefore)}`);
}

/**
 * Another asset's rows on the same key are absent; the positive case is the
 * outsider read on its own id, which returns its five rows. Mutation: drop
 * `asset_id = $1` → the asset's page holds 900+ values and reddens.
 */
export async function assertAnOutsiderOnTheSameKeyIsNotRead(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const page = await read(pool, fx.asset, 100);
  assert(page.items.length === 5, `the asset's page must hold its 5 rows only, got ${page.items.length}`);
  assert(
    page.items.every((i) => i.value < 900),
    `an outsider's row reached the page: ${JSON.stringify(page.items.map((i) => i.value))}`,
  );
  const outsider = await read(pool, fx.outsider, 100);
  assert(outsider.items.length === 5, `the outsider's own read must find its 5 rows, got ${outsider.items.length}`);
}

/**
 * No `before` bounds the page by the `now` the caller passes, a bound
 * parameter: a `now` of minute 2 reads minutes 1 and 0 only. Mutation: drop
 * the upper bound when `before` is absent → all five rows come back. (SQL
 * `now()` in its place would hide the far-future fixture entirely, which
 * {@link assertNewestFirstWithDeviceTime} catches.)
 */
export async function assertTheNewestPageIsBoundedByNow(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const early = await service(pool).pointRawRecords(
    { assetId: fx.asset, pointKey: POINT_KEY },
    { limit: 10, now: at(2) },
  );
  assert(
    JSON.stringify(early.items.map((i) => i.value)) === JSON.stringify([11, 10]),
    `a now of minute 2 must read minutes 1 and 0 only, got ${JSON.stringify(early.items.map((i) => i.value))}`,
  );
}
