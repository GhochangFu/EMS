import { billedUnits, computeBill, loadUnitForBasis, type ComputedBill, type EnergyBillReason } from "@bms/shared";
import type { Pool } from "pg";

import { averagePf } from "../reports/energy-view-read";
import { levelForRange } from "../telemetry/point-aggregates";
import type { MappingRow } from "./location-tariff-read";
import { elapsedShare, monthFirstDay, monthWindow } from "./month-window";
import { deltaOfProbe, readRegisterProbes, type RegisterRequest } from "./register-read";
import { pairKey, pickVersion, readVersions, type TariffVersion } from "./tariff-versions";

/**
 * `F4.365` (ADR 0134 decisions 4–7, Amendment 1) — the monthly bill of a
 * mapped location, from its billing meter's register deltas.
 *
 * Window is `[month start, min(next month start, now))` in the location's
 * zone; `complete` is false while the month runs. Reads run on the fleet pool
 * (plan D12); the organization equality lives in each reader. Nothing here
 * falls back to the flat `energy_tariff_per_kwh`: a mapped location whose bill
 * cannot be computed answers a reason (plan D10).
 */
export type PfReader = (input: { start: Date; end: Date; assetId: string; now: Date }) => Promise<number | null>;

export interface BillWindow {
  start: Date;
  end: Date;
}

export type BillComputation =
  | {
      ok: true;
      window: BillWindow;
      complete: boolean;
      version: TariffVersion;
      units: number;
      unitType: "kwh" | "kvah";
      estimated: boolean;
      /** The billing meter's kWh over the window — the live rate's divisor (plan Q4). */
      kwh: number | null;
      bill: ComputedBill;
    }
  | { ok: false; window: BillWindow; complete: boolean; version: TariffVersion | null; reason: EnergyBillReason };

export interface BillTarget {
  mapping: MappingRow;
  month: string;
  /** Amendment 1: prorate the fixed charge by the month's elapsed share (live rate only). */
  prorateFixed?: boolean;
}

export class EnergyBillService {
  constructor(
    private readonly pool: Pick<Pool, "query">,
    private readonly pf: PfReader = defaultPfReader(pool),
  ) {}

  async computeBills(targets: readonly BillTarget[], now: Date): Promise<BillComputation[]> {
    if (targets.length === 0) return [];
    const versions = await readVersions(
      this.pool,
      targets.map((t) => ({ organizationId: t.mapping.organizationId, key: t.mapping.tariffKey })),
    );
    const plans = targets.map((t) => {
      const full = monthWindow(t.month, t.mapping.zone);
      const end = new Date(Math.min(full.end.getTime(), now.getTime()));
      const window = { start: full.start, end };
      const version = pickVersion(versions.get(pairKey(t.mapping.organizationId, t.mapping.tariffKey)) ?? [], monthFirstDay(t.month));
      return { t, full, window, complete: now.getTime() >= full.end.getTime(), version };
    });

    const requests: RegisterRequest[] = [];
    const index = plans.map((p) => {
      if (p.version === null || p.window.end <= p.window.start) return null;
      const kwhAt = requests.push({ assetId: p.t.mapping.billingMeterAssetId, pointKey: "kwh_total", from: p.window.start, to: p.window.end }) - 1;
      const kvahAt =
        p.version.energyUnit === "kvah"
          ? requests.push({ assetId: p.t.mapping.billingMeterAssetId, pointKey: "kvah_total", from: p.window.start, to: p.window.end }) - 1
          : null;
      return { kwhAt, kvahAt };
    });
    const probes = await readRegisterProbes(this.pool, requests);

    const out: BillComputation[] = [];
    for (let i = 0; i < plans.length; i += 1) {
      const { t, full, window, complete, version } = plans[i];
      const fail = (reason: EnergyBillReason): BillComputation => ({ ok: false, window, complete, version, reason });
      if (version === null) {
        out.push(fail("no_version_in_force"));
        continue;
      }
      const needed = loadUnitForBasis(version.fixedBasis);
      if (needed !== null && needed !== t.mapping.sanctionedLoadUnit) {
        out.push(fail("load_unit_mismatch"));
        continue;
      }
      const at = index[i];
      if (at === null) {
        out.push(fail("meter_no_reading"));
        continue;
      }
      const kwh = deltaOfProbe(probes[at.kwhAt]);
      const kvah = at.kvahAt === null ? ({ ok: false, reason: "empty" } as const) : deltaOfProbe(probes[at.kvahAt]);
      const needsPf = version.energyUnit === "kvah" && !kvah.ok && kvah.reason === "empty" && kwh.ok;
      const pf = needsPf ? await this.pf({ start: window.start, end: window.end, assetId: t.mapping.billingMeterAssetId, now }) : null;
      const units = billedUnits({ energyUnit: version.energyUnit, kwh, kvah, averagePf: pf });
      if (!units.ok) {
        out.push(fail(units.reason));
        continue;
      }
      let bill: ComputedBill;
      try {
        bill = computeBill({
          slabs: version.slabs,
          fixedBasis: version.fixedBasis,
          units: units.units,
          sanctionedLoad: t.mapping.sanctionedLoad,
          fixedFraction: t.prorateFixed ? elapsedShare(full, now) : 1,
        });
      } catch (error) {
        // `computeBill` refuses a malformed version (no slabs, a negative rate) with a
        // `RangeError`: that target fails with a reason, the rest of the batch still bills.
        if (!(error instanceof RangeError)) throw error;
        out.push(fail("version_invalid"));
        continue;
      }
      out.push({
        ok: true,
        window,
        complete,
        version,
        units: units.units,
        unitType: version.energyUnit,
        estimated: units.estimated,
        kwh: kwh.ok ? kwh.value : null,
        bill,
      });
    }
    return out;
  }
}

/** Average `pf` of the meter over the window, at the finest hourly level its age allows. */
export function defaultPfReader(pool: Pick<Pool, "query">): PfReader {
  return async ({ start, end, assetId, now }) => {
    const { level } = levelForRange({ start, granularity: "1h", now });
    const pf = await averagePf(pool, { level, start, end, assetIds: [assetId] });
    return pf === null || !Number.isFinite(pf) ? null : pf;
  };
}
