import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";

import type { BmsDb } from "@bms/db";
import {
  ADVISORY_ANOMALY_CONTEXT_MAX,
  ADVISORY_MAX_ASSETS,
  ADVISORY_WINDOW_DAYS,
  type Advisory,
  type AdvisoriesResponse,
  type AssetAnomaliesResponse,
} from "@bms/shared";

import { inputKey } from "../calc/calc-batch";
import type { ParameterSeriesRow } from "../calc/calc-parameter-series";
import { FLEET_DRIZZLE, FLEET_POOL, TENANT_DRIZZLE } from "../database/database.tokens";
import { withReadScope } from "../database/tenant-read-scope";
import { MlAnomaliesService } from "../ml/ml-anomalies.service";
import { EnergyRateResolver } from "../tariffs/energy-rate-resolver";
import { mappingInForce, readMappingsForAssets, type MappingRow } from "../tariffs/location-tariff-read";
import { deltaOfProbe, readRegisterProbes, type RegisterRequest, type Sample } from "../tariffs/register-read";
import { pairKey, pickVersion, readVersions, type TariffVersion } from "../tariffs/tariff-versions";
import { readLocalHourEnergy, type HourlyEnergy } from "../telemetry/energy-cost-by-day";
import {
  candidateOf,
  readAdvisoryCandidates,
  readPairHours,
  readTopEnergyAssets,
  type AdvisoryCandidateDbRow,
} from "./advisories.reads";
import { anomalyContextOf, withAnomalyContext } from "./advisory-consumption";
import {
  ADVISORY_PARAMETER_KEYS,
  type AdvisoryAssetInput,
  type AdvisoryCandidate,
  type AdvisoryPairHour,
  type AdvisoryRegisters,
  type AdvisorySeries,
  type AdvisoryTariff,
  type AdvisoryWindows,
} from "./advisory-engine.types";
import { hasUsableRegisters } from "./advisory-power-factor";
import { advisoriesForAsset, rankAdvisories } from "./advisory-rank";
import { advisoryWindows } from "./advisory-window";

/**
 * `E1.6a` / ADR 0137 decisions 2, 4, 6 and 9 (plan T1.7, Q2, Q3, R-a, R-c, R-d,
 * R-e, R-h) — the advisories of the assets a caller reads, computed when a page
 * asks. Nothing is stored and nothing is written.
 *
 * One flow for both routes ({@link computeAdvisories}):
 * 1. the candidates through `withReadScope` (row security backs a
 *    single-organization caller; the `ids` filter is the control on the fleet
 *    branch), then the meters with no zone of their own or with energy features
 *    off are dropped, then the 200 cap (R-e);
 * 2. **with the candidate ids only, never `null`** (Q3), the existing reads on
 *    the fleet pool, each holding its own organization equality: 35 days of
 *    local-hour energy (`readLocalHourEnergy`, Q2), the four parameter series
 *    (`EnergyRateResolver.resolveSeriesForAssets`), the register probes, the
 *    hourly kW/kVA/PF pairs, and the tariff mapping and version in force on the
 *    window's last day (R-h);
 * 3. the pure engine and the order;
 * 4. the anomaly context (R-d) for at most 25 excess advisories in that order,
 *    through `MlAnomaliesService.forAsset` on each advisory's exact window. A
 *    failed anomaly read leaves that advisory without a context line; the
 *    response never fails for it, and no number changes.
 */

/** Every read the flow makes, as a seam: the service wires the real ones, the spec fakes them. */
export interface AdvisoryReads {
  /** Through `withReadScope`: `ids` is `narrow`'s value (`null` for the unrestricted admin). */
  candidates(ids: string[] | null): Promise<AdvisoryCandidateDbRow[]>;
  topEnergy(ids: readonly string[], sinceMs: number, limit: number): Promise<string[]>;
  hours(assets: readonly { assetId: string; zone: string }[], from: Date, to: Date): Promise<HourlyEnergy[]>;
  series(pairs: readonly { assetId: string; key: string }[], from: Date, to: Date): Promise<Map<string, ParameterSeriesRow[]>>;
  registers(requests: readonly RegisterRequest[]): Promise<{ first: Sample | null; last: Sample | null }[]>;
  pairHours(ids: readonly string[], fromMs: number, toMs: number): Promise<Map<string, AdvisoryPairHour[]>>;
  mappings(ids: readonly string[]): Promise<Map<string, MappingRow[]>>;
  versions(pairs: readonly { organizationId: string; key: string }[]): Promise<Map<string, TariffVersion[]>>;
  anomalies(assetId: string, window: { from: Date; to: Date }, now: Date): Promise<AssetAnomaliesResponse>;
}

/** What the real reads need. */
export interface AdvisoryReadDeps {
  readonly tenantDb: BmsDb;
  readonly fleetDb: BmsDb;
  readonly pool: Pick<Pool, "query">;
  readonly rates: Pick<EnergyRateResolver, "resolveSeriesForAssets">;
  readonly anomalies: Pick<MlAnomaliesService, "forAsset">;
}

/** The real reads: the candidates through `withReadScope`, everything else on the fleet pool. */
export function advisoryReadsOf(deps: AdvisoryReadDeps): AdvisoryReads {
  const { tenantDb, fleetDb, pool, rates, anomalies } = deps;
  return {
    candidates: (ids) => withReadScope(tenantDb, fleetDb, ids, () => [], (tx) => readAdvisoryCandidates(tx, ids)),
    topEnergy: (ids, sinceMs, limit) => readTopEnergyAssets(pool, ids, sinceMs, limit),
    hours: (assets, from, to) => readLocalHourEnergy(pool, assets, from, to),
    series: (pairs, from, to) => rates.resolveSeriesForAssets(pairs, from, to),
    registers: (requests) => readRegisterProbes(pool, requests),
    pairHours: (ids, fromMs, toMs) => readPairHours(pool, ids, fromMs, toMs),
    mappings: (ids) => readMappingsForAssets(pool, ids),
    versions: (pairs) => readVersions(pool, pairs),
    anomalies: (assetId, window, now) => anomalies.forAsset(assetId, window, now),
  };
}

const DAY_MS = 86_400_000;

/** A register probe's first-to-last span, ms; `0` when it has no pair of samples. */
const spanOf = (probe: { first: Sample | null; last: Sample | null }): number =>
  probe.first === null || probe.last === null ? 0 : Math.max(0, probe.last.timeMs - probe.first.timeMs);

/** The tariff version in force on the window's last day for this asset, or `null` (plan R-h). */
function tariffOf(
  candidate: AdvisoryCandidate,
  windows: AdvisoryWindows,
  mappings: ReadonlyMap<string, MappingRow[]>,
  versions: ReadonlyMap<string, TariffVersion[]>,
): AdvisoryTariff | null {
  const lastDay = windows.days[windows.days.length - 1]!;
  const mapping = mappingInForce(mappings.get(candidate.assetId) ?? [], lastDay);
  if (mapping === null) return null;
  const version = pickVersion(versions.get(pairKey(mapping.organizationId, mapping.tariffKey)) ?? [], lastDay);
  if (version === null) return null;
  return {
    name: version.name,
    effectiveFrom: version.effectiveFrom,
    energyUnit: version.energyUnit,
    billingMeter: mapping.billingMeterAssetIds.includes(candidate.assetId),
  };
}

/** The response of `ids` (`narrow`'s value, or one asset) at `now`: one clock for the whole request. */
export async function computeAdvisories(reads: AdvisoryReads, ids: string[] | null, now: Date): Promise<AdvisoriesResponse> {
  const nowMs = now.getTime();
  const empty = (candidates: number, considered: number): AdvisoriesResponse => ({
    asOf: now.toISOString(),
    candidates,
    considered,
    advisories: [],
  });
  if (ids !== null && ids.length === 0) return empty(0, 0);

  // 1. Candidates, then the zone and energy drops, then the cap.
  const all = (await reads.candidates(ids))
    .map(candidateOf)
    .filter((candidate): candidate is AdvisoryCandidate => candidate !== null);
  let considered = all;
  if (all.length > ADVISORY_MAX_ASSETS) {
    const top = await reads.topEnergy(
      all.map((c) => c.assetId),
      nowMs - ADVISORY_WINDOW_DAYS * DAY_MS,
      ADVISORY_MAX_ASSETS,
    );
    const byId = new Map(all.map((c) => [c.assetId, c]));
    considered = top.map((id) => byId.get(id)).filter((c): c is AdvisoryCandidate => c !== undefined);
  }
  if (considered.length === 0) return empty(all.length, 0);

  // 2. One window per zone (R-a); the read ranges are their union.
  const windowsByZone = new Map<string, AdvisoryWindows>();
  for (const c of considered) {
    if (!windowsByZone.has(c.zone)) windowsByZone.set(c.zone, advisoryWindows(nowMs, c.zone));
  }
  const windowsOf = (c: AdvisoryCandidate): AdvisoryWindows => windowsByZone.get(c.zone)!;
  const zones = [...windowsByZone.values()];
  const readFromMs = Math.min(...zones.map((w) => w.readFromMs));
  const readToMs = Math.max(...zones.map((w) => w.readToMs));
  const fromMs = Math.min(...zones.map((w) => w.fromMs));
  const toMs = Math.max(...zones.map((w) => w.toMs));
  const consideredIds = considered.map((c) => c.assetId);

  const keys = Object.values(ADVISORY_PARAMETER_KEYS);
  const registerAssets = considered.filter((c) => c.domain === "electrical" && c.points.kwhTotal && c.points.kvahTotal);
  const registerRequests: RegisterRequest[] = registerAssets.flatMap((c) => {
    const w = windowsOf(c);
    const window = { from: new Date(w.fromMs), to: new Date(w.toMs) };
    return [
      { assetId: c.assetId, pointKey: "kwh_total" as const, ...window },
      { assetId: c.assetId, pointKey: "kvah_total" as const, ...window },
    ];
  });

  const [hours, series, probes, mappings] = await Promise.all([
    // `readLocalHourEnergy` is inclusive at its end; one millisecond short leaves today out.
    reads.hours(considered.map((c) => ({ assetId: c.assetId, zone: c.zone })), new Date(readFromMs), new Date(readToMs - 1)),
    reads.series(
      considered.flatMap((c) => keys.map((key) => ({ assetId: c.assetId, key }))),
      new Date(fromMs),
      new Date(toMs - 1),
    ),
    reads.registers(registerRequests),
    reads.mappings(consideredIds),
  ]);

  const registersOf = new Map<string, AdvisoryRegisters>();
  registerAssets.forEach((c, i) => {
    const kwhProbe = probes[2 * i] ?? { first: null, last: null };
    const kvahProbe = probes[2 * i + 1] ?? { first: null, last: null };
    const kwh = deltaOfProbe(kwhProbe);
    const kvah = deltaOfProbe(kvahProbe);
    registersOf.set(c.assetId, {
      kwh: kwh.ok ? kwh.value : null,
      kvah: kvah.ok ? kvah.value : null,
      spanMs: Math.min(spanOf(kwhProbe), spanOf(kvahProbe)),
    });
  });
  const noRegisters: AdvisoryRegisters = { kwh: null, kvah: null, spanMs: 0 };

  const pairIds = considered
    .filter((c) => c.domain === "electrical" && (c.points.kva || c.points.pf) && !hasUsableRegisters(registersOf.get(c.assetId) ?? noRegisters, windowsOf(c)))
    .map((c) => c.assetId);
  const versionPairs = new Map<string, { organizationId: string; key: string }>();
  for (const c of considered) {
    const lastDay = windowsOf(c).days[ADVISORY_WINDOW_DAYS - 1]!;
    const mapping = mappingInForce(mappings.get(c.assetId) ?? [], lastDay);
    if (mapping !== null) {
      versionPairs.set(pairKey(mapping.organizationId, mapping.tariffKey), {
        organizationId: mapping.organizationId,
        key: mapping.tariffKey,
      });
    }
  }
  const [pairs, versions] = await Promise.all([
    pairIds.length === 0 ? Promise.resolve(new Map<string, AdvisoryPairHour[]>()) : reads.pairHours(pairIds, fromMs, toMs),
    versionPairs.size === 0 ? Promise.resolve(new Map<string, TariffVersion[]>()) : reads.versions([...versionPairs.values()]),
  ]);

  // 3. The engine, one asset at a time, and the order.
  const hoursOf = new Map<string, HourlyEnergy[]>();
  for (const hour of hours) {
    const list = hoursOf.get(hour.assetId);
    if (list) list.push(hour);
    else hoursOf.set(hour.assetId, [hour]);
  }
  const seriesOf = (assetId: string): AdvisorySeries => ({
    rate: series.get(inputKey(assetId, ADVISORY_PARAMETER_KEYS.rate)) ?? [],
    pfBand: series.get(inputKey(assetId, ADVISORY_PARAMETER_KEYS.pfBand)) ?? [],
    carbonFactor: series.get(inputKey(assetId, ADVISORY_PARAMETER_KEYS.carbonFactor)) ?? [],
    baseline: series.get(inputKey(assetId, ADVISORY_PARAMETER_KEYS.baseline)) ?? [],
  });
  const advisories = rankAdvisories(
    considered.flatMap((candidate) => {
      const input: AdvisoryAssetInput = {
        candidate,
        hours: hoursOf.get(candidate.assetId) ?? [],
        pairHours: pairs.get(candidate.assetId) ?? [],
        registers: registersOf.get(candidate.assetId) ?? noRegisters,
        tariff: tariffOf(candidate, windowsOf(candidate), mappings, versions),
        series: seriesOf(candidate.assetId),
      };
      return advisoriesForAsset(input, windowsOf(candidate));
    }),
  );

  // 4. The anomaly context, after the numbers are final (R-d).
  const zoneOf = new Map(considered.map((c) => [c.assetId, c.zone]));
  const out: Advisory[] = [];
  let contextReads = 0;
  for (const advisory of advisories) {
    if (advisory.kind !== "excess_consumption" || contextReads >= ADVISORY_ANOMALY_CONTEXT_MAX) {
      out.push(advisory);
      continue;
    }
    contextReads += 1;
    const windows = windowsByZone.get(zoneOf.get(advisory.assetId)!)!;
    try {
      const scores = await reads.anomalies(
        advisory.assetId,
        { from: new Date(windows.fromMs), to: new Date(windows.toMs) },
        now,
      );
      out.push(withAnomalyContext(advisory, anomalyContextOf(scores.scores, windows)));
    } catch {
      // A failed anomaly read means no context line, never a failed response (R-d).
      out.push(advisory);
    }
  }

  return { asOf: now.toISOString(), candidates: all.length, considered: considered.length, advisories: out };
}

/**
 * The service both routes call. Slots 0–2 are the tenant and fleet handles
 * `withReadScope` takes and the fleet pool every reused read takes
 * (`database/fleet-read-wiring.spec.ts`); `MlAnomaliesService` is this module's
 * own provider (R-c).
 */
@Injectable()
export class AdvisoriesService {
  private readonly reads: AdvisoryReads;

  constructor(
    @Inject(TENANT_DRIZZLE) tenantDb: BmsDb,
    @Inject(FLEET_DRIZZLE) fleetDb: BmsDb,
    @Inject(FLEET_POOL) pool: Pool,
    @Inject(EnergyRateResolver) rates: Pick<EnergyRateResolver, "resolveSeriesForAssets">,
    @Inject(MlAnomaliesService) anomalies: Pick<MlAnomaliesService, "forAsset">,
  ) {
    this.reads = advisoryReadsOf({ tenantDb, fleetDb, pool, rates, anomalies });
  }

  /** `GET /advisories`: `assetIds` is `narrow`'s value, unchanged (`null`: the unrestricted admin). */
  list(assetIds: string[] | null, now: Date): Promise<AdvisoriesResponse> {
    return computeAdvisories(this.reads, assetIds, now);
  }

  /** `GET /assets/:assetId/advisories`, after the controller's `canReadAsset`. */
  forAsset(assetId: string, now: Date): Promise<AdvisoriesResponse> {
    return computeAdvisories(this.reads, [assetId], now);
  }
}
