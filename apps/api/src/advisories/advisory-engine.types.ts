import type { ParameterSeriesRow } from "../calc/calc-parameter-series";
import { ENERGY_TARIFF_KEY } from "../telemetry/energy-cost";
import type { HourlyEnergy } from "../telemetry/energy-cost-by-day";
import type { TariffVersion } from "../tariffs/tariff-versions";

/**
 * `E1.6a` / ADR 0137 (plan §4, T1.4) — what the pure advisory engine reads,
 * one asset at a time. No database, no clock: the service fills this from the
 * reads it already has and passes the request's one instant as `nowMs`.
 *
 * Where each field comes from (the service, plan T1.7):
 * - `candidate` — `readAdvisoryCandidates` (labels, zone, currency, active points);
 * - `hours` — `readLocalHourEnergy` over `AdvisoryWindows.readFromMs … readToMs`;
 * - `pairHours` — `readPairHours` (hourly mean `kw`, `kva`, `pf` from `_1h`);
 * - `registers` — `readRegisterProbes` + `deltaOfProbe` over the window, `null` unless `ok`;
 * - `series` — `EnergyRateResolver.resolveSeriesForAssets` for {@link ADVISORY_PARAMETER_KEYS};
 * - `tariff` — `readMappingsForAssets` + `mappingInForce` + `readVersions` + `pickVersion`,
 *   in force on the window's last day (plan R-h).
 */

/** The four parameter keys one `resolveSeriesForAssets` call serves (migration `0074`). */
export const ADVISORY_PARAMETER_KEYS = {
  rate: ENERGY_TARIFF_KEY,
  pfBand: "tariff_pf_band",
  carbonFactor: "grid_carbon_factor_kgco2_per_kwh",
  baseline: "energy_baseline_kwh_per_day",
} as const;

/** One candidate meter: who it is, where, and which energy points it has. */
export interface AdvisoryCandidate {
  readonly assetId: string;
  readonly organizationId: string;
  readonly locationId: string;
  readonly assetCode: string;
  readonly assetName: string;
  readonly assetRtuName: string | null;
  readonly assetLocationName: string;
  /** `bms.assets.domain`; only `electrical` gets a power-factor advisory. */
  readonly domain: string;
  /** The location's own zone as shown (`resolveSiteTimeZone(...).timeZone`). */
  readonly timeZone: string;
  /** The zone days are cut in (`resolveSiteTimeZone(...).arithmeticZone`). */
  readonly zone: string;
  /** The organization's `char(3)` currency. */
  readonly currency: string;
  /** Which of the optional energy points are active on the asset. */
  readonly points: {
    readonly pf: boolean;
    readonly kva: boolean;
    readonly kwhTotal: boolean;
    readonly kvahTotal: boolean;
  };
}

/** One `_1h` bucket's hourly means; a point with no bucket is `null`. */
export interface AdvisoryPairHour {
  readonly bucketMs: number;
  readonly kw: number | null;
  readonly kva: number | null;
  readonly pf: number | null;
}

/** The register deltas over the window; `null` when the probe was not `ok`. */
export interface AdvisoryRegisters {
  readonly kwh: number | null;
  readonly kvah: number | null;
  /** The shorter of the two probes' first-to-last spans, ms; `0` when either probe is empty. */
  readonly spanMs: number;
}

/** The site's tariff version in force at the window's end (plan R-h). */
export interface AdvisoryTariff {
  readonly name: string;
  /** `YYYY-MM-DD`. */
  readonly effectiveFrom: string;
  readonly energyUnit: TariffVersion["energyUnit"];
  /** Whether this asset is one of the mapping's `billingMeterAssetIds` (plan R-i). */
  readonly billingMeter: boolean;
}

/** The dated rows of each parameter key, sorted by rank as the read returns them. */
export interface AdvisorySeries {
  /** `energy_tariff_per_kwh`, a mapped month first at rank −1 (`NaN` when unpriced). */
  readonly rate: readonly ParameterSeriesRow[];
  readonly pfBand: readonly ParameterSeriesRow[];
  readonly carbonFactor: readonly ParameterSeriesRow[];
  readonly baseline: readonly ParameterSeriesRow[];
}

/** Everything the engine needs for one asset. */
export interface AdvisoryAssetInput {
  readonly candidate: AdvisoryCandidate;
  /** Local-hour energy over the read range (window and baseline windows). */
  readonly hours: readonly HourlyEnergy[];
  /** Empty when the asset has a usable register pair. */
  readonly pairHours: readonly AdvisoryPairHour[];
  readonly registers: AdvisoryRegisters;
  readonly tariff: AdvisoryTariff | null;
  readonly series: AdvisorySeries;
}

/** The window of one zone at one instant (plan R-a). */
export interface AdvisoryWindows {
  readonly zone: string;
  /** The 7 local days, oldest first: today − 7 … today − 1. */
  readonly days: readonly string[];
  /** `BASELINE_WINDOWS` lists of 7 days; list `k − 1` is the window shifted back `k × 7` days. */
  readonly baselineDays: readonly (readonly string[])[];
  /** The window's first local midnight, epoch ms. */
  readonly fromMs: number;
  /** Today's local midnight, epoch ms (exclusive). */
  readonly toMs: number;
  /** The read range for `readLocalHourEnergy`: the oldest baseline day's midnight … `toMs`. */
  readonly readFromMs: number;
  readonly readToMs: number;
}

/** The anomaly counts of one window (plan R-d), from `MlAnomaliesService.forAsset`'s scores. */
export interface AdvisoryAnomalyContext {
  /** Distinct hours with any score at or above `ANOMALY_UNUSUAL_SCORE`. */
  readonly unusualHours: number;
  /** Of those, the hours marked by two or more detectors. */
  readonly bothHours: number;
  /** Of those, the hours marked by the Baseline method alone. */
  readonly baselineOnlyHours: number;
}
