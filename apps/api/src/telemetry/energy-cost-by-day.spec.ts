import type { ParameterSeriesRow } from "../calc/calc-parameter-series";
import {
  foldCostByDay,
  hourFraction,
  localDay,
  periodDays,
  scopeZone,
  shiftDay,
  sumCostDays,
  windowDays,
  type CostScopeAsset,
  type HourlyEnergy,
} from "./energy-cost-by-day";

/**
 * `F4.332` (ADR 0070 Amendment 7) — the pure half of the cost per local day. The database half
 * (`readEnergyCostByDay`: the `_5m` read folded into local hours, the dated rate rows, RLS) is asserted in
 * `energy-cost-by-day.integration.spec.ts`. One claim per function, so a mutation reddens the
 * one assertion it names (AGENTS.md §4.6).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const KOLKATA = "Asia/Kolkata";
const A: CostScopeAsset = { assetId: "a", zone: KOLKATA, currency: "INR" };
const B: CostScopeAsset = { assetId: "b", zone: KOLKATA, currency: "INR" };

/** 2026-11-05 00:00 in Kolkata is 2026-11-04T18:30Z. */
const KOLKATA_MIDNIGHT_NOV_5 = Date.parse("2026-11-04T18:30:00Z");
const HOUR = 3_600_000;
const hourOfNov5 = (h: number): number => KOLKATA_MIDNIGHT_NOV_5 + h * HOUR;

const flat = (value: number, fromMs = 0, toMs: number | null = null, rank = 1_000_000): ParameterSeriesRow => ({
  fromMs,
  toMs,
  value,
  rank,
});

/** 24 hours of 10 kWh each on 2026-11-05 (Kolkata) for one asset. */
const fullDay = (assetId: string, kwh = 10): HourlyEnergy[] =>
  Array.from({ length: 24 }, (_, h) => ({ assetId, bucketMs: hourOfNov5(h), kwh }));

export function assertOneRateIsKwhTimesRate(): void {
  const [row] = foldCostByDay([A], fullDay("a"), new Map([["a", [flat(8)]]]), ["2026-11-05"]);
  assert(row?.kwh === 240 && row.cost === 1920 && row.reason === null && row.currency === "INR",
    `240 kWh at 8 must cost 1920, got ${JSON.stringify(row)}`);
}

export function assertAMidDayRateChangeSplitsTheDay(): void {
  // The organization row changes from 8 to 10 at 14:00 local: 14 hours at 8, 10 hours at 10.
  const change = hourOfNov5(14);
  const series = [flat(8, 0, change), flat(10, change, null)];
  const [row] = foldCostByDay([A], fullDay("a"), new Map([["a", series]]), ["2026-11-05"]);
  assert(row?.cost === 14 * 10 * 8 + 10 * 10 * 10, `a 14:00 change must split the day, got ${row?.cost}`);
}

export function assertTheNearestScopeWinsPerHour(): void {
  // An asset row (rank 0) covering only 06:00–08:00 beats the organization row for those hours.
  const series = [flat(20, hourOfNov5(6), hourOfNov5(8), 0), flat(8)];
  const [row] = foldCostByDay([A], fullDay("a"), new Map([["a", series]]), ["2026-11-05"]);
  assert(row?.cost === 22 * 10 * 8 + 2 * 10 * 20, `the asset row must win its two hours, got ${row?.cost}`);
}

export function assertAnEditedOldRateRepricesOnlyItsDays(): void {
  // Two days; the rate row for Nov 4 is edited from 8 to 9. Nov 5 keeps its own row's price.
  const nov4 = Array.from({ length: 24 }, (_, h) => ({ assetId: "a", bucketMs: hourOfNov5(h) - 24 * HOUR, kwh: 10 }));
  const hours = [...nov4, ...fullDay("a")];
  const before = [flat(8, 0, KOLKATA_MIDNIGHT_NOV_5), flat(8, KOLKATA_MIDNIGHT_NOV_5, null)];
  const after = [flat(9, 0, KOLKATA_MIDNIGHT_NOV_5), flat(8, KOLKATA_MIDNIGHT_NOV_5, null)];
  const days = ["2026-11-04", "2026-11-05"];
  const was = foldCostByDay([A], hours, new Map([["a", before]]), days);
  const now = foldCostByDay([A], hours, new Map([["a", after]]), days);
  assert(was[0]?.cost === 1920 && now[0]?.cost === 2160, `Nov 4 must re-price: ${was[0]?.cost} -> ${now[0]?.cost}`);
  assert(was[1]?.cost === now[1]?.cost && now[1]?.cost === 1920, `Nov 5 must not change: ${was[1]?.cost} -> ${now[1]?.cost}`);
}

export function assertAMissingRateIsNullWithTheReason(): void {
  // The rate starts at 03:00: three hours with energy have no rate, so the day fails closed.
  const [row] = foldCostByDay([A], fullDay("a"), new Map([["a", [flat(8, hourOfNov5(3), null)]]]), ["2026-11-05"]);
  assert(row?.cost === null && row.reason === "rate_missing" && row.kwh === 240,
    `an unpriced hour must null the day with rate_missing, got ${JSON.stringify(row)}`);
}

export function assertAnUnpricedHourWithNoEnergyCostsNothing(): void {
  const hours = fullDay("a").map((hour, h) => (h < 3 ? { ...hour, kwh: 0 } : hour));
  const [row] = foldCostByDay([A], hours, new Map([["a", [flat(8, hourOfNov5(3), null)]]]), ["2026-11-05"]);
  assert(row?.cost === 21 * 10 * 8 && row.reason === null, `zero-energy hours need no rate, got ${JSON.stringify(row)}`);
}

export function assertTwoCurrenciesAreNullEveryDay(): void {
  const usd: CostScopeAsset = { assetId: "b", zone: KOLKATA, currency: "USD" };
  const rows = foldCostByDay([A, usd], [...fullDay("a"), ...fullDay("b")],
    new Map([["a", [flat(8)]], ["b", [flat(1)]]]), ["2026-11-05"]);
  assert(rows[0]?.cost === null && rows[0].reason === "currency_mixed" && rows[0].currency === null,
    `two currencies must null the day, got ${JSON.stringify(rows[0])}`);
}

export function assertADayWithNoBucketIsNoEnergy(): void {
  const rows = foldCostByDay([A], fullDay("a"), new Map([["a", [flat(8)]]]), ["2026-11-04", "2026-11-05"]);
  assert(rows[0]?.cost === null && rows[0].kwh === null && rows[0].reason === "no_energy",
    `a day with no bucket must be no_energy, got ${JSON.stringify(rows[0])}`);
}

export function assertKolkataMidnightIsTheDayBoundary(): void {
  // 18:29Z is still Nov 4 in Kolkata; 18:30Z is Nov 5. One bucket each side.
  const hours: HourlyEnergy[] = [
    { assetId: "a", bucketMs: KOLKATA_MIDNIGHT_NOV_5 - HOUR, kwh: 5 },
    { assetId: "a", bucketMs: KOLKATA_MIDNIGHT_NOV_5, kwh: 7 },
  ];
  const rows = foldCostByDay([A], hours, new Map([["a", [flat(1)]]]), ["2026-11-04", "2026-11-05"]);
  assert(rows[0]?.cost === 5 && rows[1]?.cost === 7, `the boundary is local midnight, got ${JSON.stringify(rows)}`);
  assert(localDay(KOLKATA_MIDNIGHT_NOV_5 - 1, KOLKATA) === "2026-11-04" && localDay(KOLKATA_MIDNIGHT_NOV_5, KOLKATA) === "2026-11-05",
    "localDay must read the Kolkata calendar");
}

export function assertTheScopeSumsItsAssetsPerDay(): void {
  const rows = foldCostByDay([A, B], [...fullDay("a"), ...fullDay("b", 5)],
    new Map([["a", [flat(8)]], ["b", [flat(10)]]]), ["2026-11-05"]);
  assert(rows[0]?.cost === 1920 + 1200 && rows[0].kwh === 360, `the day must sum both assets, got ${JSON.stringify(rows[0])}`);
}

export function assertTotalsSumTheRoundedDays(): void {
  const total = sumCostDays([
    { day: "2026-11-03", kwh: 1, cost: 10.005, currency: "INR", reason: null },
    { day: "2026-11-04", kwh: null, cost: null, currency: "INR", reason: "no_energy" },
    { day: "2026-11-05", kwh: 1, cost: 1.11, currency: "INR", reason: null },
  ]);
  assert(total.value === 11.12 && total.coverage.fresh === 2 && total.coverage.carrying === 3 && total.reason === null,
    `the total must sum the priced days with coverage, got ${JSON.stringify(total)}`);
}

export function assertANoPricedDayTotalIsNullWithTheReason(): void {
  // The first day has no energy; the later one has energy and no rate: the total says rate_missing.
  const total = sumCostDays([
    { day: "2026-11-04", kwh: null, cost: null, currency: "INR", reason: "no_energy" },
    { day: "2026-11-05", kwh: 3, cost: null, currency: "INR", reason: "rate_missing" },
  ]);
  assert(total.value === null && total.reason === "rate_missing", `no priced day must be null with the strongest reason, got ${JSON.stringify(total)}`);
}

export function assertTheWindowAndPeriodArithmetic(): void {
  assert(JSON.stringify(windowDays("2026-03-01", 3)) === JSON.stringify(["2026-02-27", "2026-02-28", "2026-03-01"]),
    "windowDays must count calendar days back across a month end");
  assert(shiftDay("2028-03-01", -1) === "2028-02-29", "shiftDay must know a leap year");
  assert(periodDays("today", "2026-11-07") === 1 && periodDays("last_7_days", "2026-11-07") === 7 &&
    periodDays("this_month", "2026-11-07") === 7 && periodDays("this_month", "2026-11-30") === 30,
    "periodDays must give 1, 7 and the day of the month");
}

export function assertTheScopeZoneIsSharedOrTheOrganizations(): void {
  assert(scopeZone([A, B], "Etc/UTC") === KOLKATA, "one shared zone must win");
  assert(scopeZone([A, { ...B, zone: "Europe/London" }], "Etc/UTC") === "Etc/UTC", "two zones must give the organization's");
}

export function assertTheOpenHourCountsOnlyTimePassed(): void {
  assert(hourFraction(0, HOUR * 2) === 1, "a closed hour counts whole");
  assert(hourFraction(0, HOUR / 4) === 0.25, "a quarter-passed hour counts a quarter");
  assert(hourFraction(HOUR, 0) === 0, "a future bucket counts nothing");
}
