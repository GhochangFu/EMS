import type { ParameterSeriesRow } from "../calc/calc-parameter-series";
import type { HourlyEnergy } from "../telemetry/energy-cost-by-day";
import type {
  AdvisoryAssetInput,
  AdvisoryCandidate,
  AdvisoryPairHour,
  AdvisoryTariff,
  AdvisoryWindows,
} from "./advisory-engine.types";
import { advisoryWindows } from "./advisory-window";

/**
 * `E1.6a` / ADR 0137 (plan T1.4) — one fixture for every engine spec. Made-up
 * names only (the repository is public): organization `FXA` "Fixture Works",
 * site "North Yard", meters `EM-01`…, tariff "Fixture HT kVAh".
 *
 * The request instant is 2026-11-17 11:30 in Kolkata, so the window is
 * 10–16 Nov 2026 and the baseline windows run back to 13 Oct.
 */
export const FIXTURE_NOW_MS = Date.parse("2026-11-17T06:00:00Z");
export const FIXTURE_ZONE = "Asia/Kolkata";
export const FIXTURE_WINDOWS: AdvisoryWindows = advisoryWindows(FIXTURE_NOW_MS, FIXTURE_ZONE);
/** The window's length: register probes spanning it all (plan §4.2, owner ruling 2026-11-17). */
export const FIXTURE_WINDOW_MS = FIXTURE_WINDOWS.toMs - FIXTURE_WINDOWS.fromMs;

export const FIXTURE_ORGANIZATION_ID = "0f0a0000-0000-4000-8000-000000000001";
export const FIXTURE_LOCATION_ID = "0f0a0000-0000-4000-8000-000000000002";
export const FIXTURE_ASSET_ID = "0f0a0000-0000-4000-8000-000000000101";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Meter `EM-01` of "North Yard", electrical, with every optional energy point. */
export function fixtureCandidate(overrides: Partial<AdvisoryCandidate> = {}): AdvisoryCandidate {
  return {
    assetId: FIXTURE_ASSET_ID,
    organizationId: FIXTURE_ORGANIZATION_ID,
    locationId: FIXTURE_LOCATION_ID,
    assetCode: "EM-01",
    assetName: "Fixture incomer meter",
    assetRtuName: null,
    assetLocationName: "North Yard",
    domain: "electrical",
    timeZone: FIXTURE_ZONE,
    zone: FIXTURE_ZONE,
    currency: "INR",
    points: { pf: true, kva: true, kwhTotal: true, kvahTotal: true },
    ...overrides,
  };
}

/** The site's kVAh tariff, with this meter as a billing meter. */
export const FIXTURE_TARIFF_KVAH: AdvisoryTariff = {
  name: "Fixture HT kVAh",
  effectiveFrom: "2026-04-01",
  energyUnit: "kvah",
  billingMeter: true,
};

/** One open-ended series row from the epoch. */
export function seriesRow(value: number, rank: number, fromMs = 0, toMs: number | null = null): ParameterSeriesRow {
  return { fromMs, toMs, value, rank };
}

/** A steady `kw` every local hour of `[fromMs, toMs)`, at most `limit` hours. */
export function steadyHours(fromMs: number, toMs: number, kw: number, limit = Infinity): HourlyEnergy[] {
  const out: HourlyEnergy[] = [];
  for (let t = fromMs; t < toMs && out.length < limit; t += HOUR_MS) {
    out.push({ assetId: FIXTURE_ASSET_ID, bucketMs: t, kwh: kw });
  }
  return out;
}

/** The window's 168 hours at `kw` (`limit` cuts coverage). */
export function windowHours(kw: number, limit = Infinity): HourlyEnergy[] {
  return steadyHours(FIXTURE_WINDOWS.fromMs, FIXTURE_WINDOWS.toMs, kw, limit);
}

/**
 * Baseline window `k` (1…4) at `kws[k − 1]`; `null` leaves that window empty.
 * Kolkata has no DST, so a window is exactly 7 × 24 hours.
 */
export function baselineHours(kws: readonly (number | null)[]): HourlyEnergy[] {
  return kws.flatMap((kw, i) => {
    if (kw === null) return [];
    const fromMs = FIXTURE_WINDOWS.fromMs - (i + 1) * 7 * DAY_MS;
    return steadyHours(fromMs, fromMs + 7 * DAY_MS, kw);
  });
}

/** Hourly means over the window from one row builder. */
export function pairHours(make: (index: number) => Omit<AdvisoryPairHour, "bucketMs">): AdvisoryPairHour[] {
  const out: AdvisoryPairHour[] = [];
  for (let t = FIXTURE_WINDOWS.fromMs, i = 0; t < FIXTURE_WINDOWS.toMs; t += HOUR_MS, i += 1) {
    out.push({ bucketMs: t, ...make(i) });
  }
  return out;
}

/**
 * The default: `EM-01` at 50 kW for the whole window (8,400 kWh), registers of
 * 8,700 kWh / 10,000 kVAh (PF 0.87) spanning the window, the kVAh tariff at 10 per kWh (cost
 * 84,000), no other parameter.
 */
export function fixtureInput(overrides: Partial<AdvisoryAssetInput> = {}): AdvisoryAssetInput {
  return {
    candidate: fixtureCandidate(),
    hours: windowHours(50),
    pairHours: [],
    registers: { kwh: 8700, kvah: 10000, spanMs: FIXTURE_WINDOW_MS },
    tariff: FIXTURE_TARIFF_KVAH,
    series: { rate: [seriesRow(10, -1)], pfBand: [], carbonFactor: [], baseline: [] },
    ...overrides,
  };
}
