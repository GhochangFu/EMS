// Pinned to a half-hour zone that is neither UTC nor any fixture zone BEFORE
// anything reads the clock: a `Date` component read (getHours, getDate, a
// local-time constructor) anywhere in the code under test then disagrees with
// the fixture's UTC arithmetic and the IST case, so the wall-clock-as-UTC bug
// cannot pass here the way it passes in CI's UTC (the E4.1a PR 2 lesson).
process.env.TZ = "America/St_Johns";

import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { loadFixtures, type Fixtures } from "../admin/asset-templates/asset-templates.instantiate.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertACalendarWindowWithNoZoneRefuses,
  assertADeltaOverOneSampleIsEmpty,
  assertAnUnknownStoredZoneRefusesNotThrows,
  assertARollingWeekReadsThe1dViewAndTodayDoesNot,
  assertAvgIsSumOverCount,
  assertAvgTodayAtIstSiteIsAlignedToTheIstDay,
  assertDeltaTodayAcrossIstMidnight,
  assertHoursTodayAtIstSite,
  assertMinAndMaxOverTheDay,
  assertNoRequestsQueriesNothing,
  assertNoSampleInsideTheWindowIsEmpty,
  assertOneCallServesEveryReadInAtMostSevenStatements,
  assertSumIsNotTheSampleSum,
  assertSumIsTheTimeIntegral,
  assertTheWatermarksAreReadLive,
  assertThisMonthIncludesTheTailBehindThe1dWatermark,
  cleanup,
  seedWindowsFixture,
  type WindowsFixture,
} from "./calc-windows.integration.spec";

/**
 * `E4.1b` U8 — Vitest entry point for `CalcWindowsService`. Assertions live
 * in the sibling `.spec` (ADR 0014); this file owns the database lifecycle
 * and the `TZ` pin. One `it()` per claim, so a mutation reddens the assertion
 * that owns it.
 */

const connectionString = requireIntegrationDb({
  item: "E4.1b",
  label: "calc window resolver tests",
  because:
    "the composition over real continuous aggregates, the IST day boundary, the time integral and the " +
    "rows behind the 1d watermark are database behaviours a pure test cannot check.",
});

describe.skipIf(!connectionString)("E4.1b — calc window resolver", () => {
  let pool: pg.Pool | undefined;
  let fx: Fixtures;
  let fixture: WindowsFixture;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "E4.1b");
    pool = created;
    fx = await loadFixtures(created);
    await cleanup(created);
    fixture = await seedWindowsFixture(created, fx);
  }, 60_000);

  afterAll(async () => {
    if (pool) {
      await cleanup(pool, fixture);
      await pool.end();
    }
  }, 60_000);

  it("W1 — guard (a): delta({kwh}, today) across 18:30 UTC at an Asia/Kolkata site is 70", async () => {
    if (!pool) throw new Error("pool required");
    await assertDeltaTodayAcrossIstMidnight(pool, fixture);
  });

  it("W1b — hours(today) at 02:00 IST is 2", async () => {
    if (!pool) throw new Error("pool required");
    await assertHoursTodayAtIstSite(pool, fixture);
  });

  it("W1c — avg({kwh}, today) at an IST site averages only the rows after 18:30Z: the aggregate path is aligned to the IST day, not to UTC buckets", async () => {
    if (!pool) throw new Error("pool required");
    await assertAvgTodayAtIstSiteIsAlignedToTheIstDay(pool, fixture);
  });

  it("W2 — guard (b): sum({kw}, 24h) is avg × 24", async () => {
    if (!pool) throw new Error("pool required");
    await assertSumIsTheTimeIntegral(pool, fixture);
  });

  it("W2b — avg({kw}, 24h) is Σsum / Σcount", async () => {
    if (!pool) throw new Error("pool required");
    await assertAvgIsSumOverCount(pool, fixture);
  });

  it("W2c — sum is not Σ sum_value, which the 1d view does hold", async () => {
    if (!pool) throw new Error("pool required");
    await assertSumIsNotTheSampleSum(pool, fixture);
  });

  it("W3 — min and max over the day", async () => {
    if (!pool) throw new Error("pool required");
    await assertMinAndMaxOverTheDay(pool, fixture);
  });

  it("W4 — a window with no sample is window_empty, and the widened window is not", async () => {
    if (!pool) throw new Error("pool required");
    await assertNoSampleInsideTheWindowIsEmpty(pool, fixture);
  });

  it("W5 — a delta over one sample is window_empty", async () => {
    if (!pool) throw new Error("pool required");
    await assertADeltaOverOneSampleIsEmpty(pool, fixture);
  });

  it("W6 — a calendar window at a NULL-zone location is timezone_unset; the other read in the batch is unaffected", async () => {
    if (!pool) throw new Error("pool required");
    await assertACalendarWindowWithNoZoneRefuses(pool, fixture);
  });

  it("W6d — a stored zone the server does not know is timezone_unset, not a thrown batch", async () => {
    if (!pool) throw new Error("pool required");
    await assertAnUnknownStoredZoneRefusesNotThrows(pool, fixture, fx);
  });

  it("W7a — guard (c): avg({kw}, this_month) includes the rows behind the 1d watermark", async () => {
    if (!pool) throw new Error("pool required");
    await assertThisMonthIncludesTheTailBehindThe1dWatermark(pool, fixture);
  });

  it("W7b — a 7d window reads the 1d view for its whole days and never raw rows; a today window never reads 1d", async () => {
    if (!pool) throw new Error("pool required");
    await assertARollingWeekReadsThe1dViewAndTodayDoesNot(pool, fixture);
  });

  it("W8 — two owners, three reads, one call: three results in at most seven statements", async () => {
    if (!pool) throw new Error("pool required");
    await assertOneCallServesEveryReadInAtMostSevenStatements(pool, fixture);
  });

  it("W9 — the four watermarks are read live from the internal function this Timescale exposes", async () => {
    if (!pool) throw new Error("pool required");
    await assertTheWatermarksAreReadLive(pool);
  });

  it("W10 — no requests → no statement", async () => {
    await assertNoRequestsQueriesNothing();
  });
});
