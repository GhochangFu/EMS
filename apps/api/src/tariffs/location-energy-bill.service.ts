import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Pool } from "pg";

import { resolveSiteTimeZone } from "@bms/shared";
import type { EnergyBill, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { FLEET_POOL } from "../database/database.tokens";
import { EnergyBillService } from "./energy-bill.service";
import { mappingInForce, readMappingsForLocation } from "./location-tariff-read";
import { monthFirstDay, monthOf, monthWindow } from "./month-window";

/** The one sentence for an unreadable location AND an unreadable billing meter (plan D6). */
export const BILL_NOT_FOUND = "Location not found or outside your access scope";

/** How far back a bill may be asked for (plan U5). */
export const BILL_MAX_MONTHS_BACK = 24;

const monthIndex = (month: string): number => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;

/**
 * `F4.365` U5 (ADR 0134 decision 6) — `GET /locations/:locationId/energy-bill`.
 *
 * **Gate (plan D6).** The location must be in `readableLocationIds` and, when
 * a mapping is in force for the month, its billing meter in
 * `readableAssetIds`; either failure is the same 404 sentence, so a caller
 * cannot tell an unreadable meter from a missing location. An unmapped month
 * answers 200 with `reason: "no_mapping"`.
 *
 * **Month.** Default is the current month in the location's zone; a future
 * month or one more than {@link BILL_MAX_MONTHS_BACK} back is a 400. Reads run
 * on the fleet pool (plan D12) — the location's own organization is read first
 * and every reader below carries it.
 */
@Injectable()
export class LocationEnergyBillService {
  constructor(
    // Fleet read (ADR 0043 Amendment 3): the bill joins the shared catalog and telemetry (no tenant GUC); the location's organization is read first and every reader carries it (plan D12).
    @Inject(FLEET_POOL) private readonly pool: Pick<Pool, "query">,
    private readonly accessControl: AccessControlService,
    private readonly bills: EnergyBillService,
  ) {}

  async bill(jwt: JwtPayload, locationId: string, month: string | undefined, now = new Date()): Promise<EnergyBill> {
    const readableLocations = await this.accessControl.readableLocationIds(jwt);
    if (readableLocations !== null && !readableLocations.includes(locationId)) {
      throw new NotFoundException(BILL_NOT_FOUND);
    }
    const { rows } = await this.pool.query<{ organization_id: string; location_zone: string | null; organization_zone: string | null; currency: string | null }>(
      `SELECT l.organization_id, l.timezone AS location_zone, o.timezone AS organization_zone, o.currency
         FROM bms.locations l JOIN bms.organizations o ON o.id = l.organization_id
        WHERE l.id = $1`,
      [locationId],
    );
    const location = rows[0];
    if (!location) {
      throw new NotFoundException(BILL_NOT_FOUND);
    }
    const zone = resolveSiteTimeZone(location.location_zone, location.organization_zone);
    const current = monthOf(now, zone.arithmeticZone);
    const target = month ?? current;
    if (monthIndex(target) > monthIndex(current)) {
      throw new BadRequestException(`month ${target} has not started yet in ${zone.timeZone}`);
    }
    if (monthIndex(current) - monthIndex(target) > BILL_MAX_MONTHS_BACK) {
      throw new BadRequestException(`month ${target} is more than ${BILL_MAX_MONTHS_BACK} months back`);
    }

    const mapping = mappingInForce(await readMappingsForLocation(this.pool, location.organization_id, locationId), monthFirstDay(target));
    const full = monthWindow(target, zone.arithmeticZone);
    const complete = now.getTime() >= full.end.getTime();
    const base = {
      locationId,
      month: target,
      timeZone: zone.timeZone,
      currency: location.currency === null ? null : location.currency.trim(),
    };
    if (mapping === null) {
      const end = new Date(Math.min(full.end.getTime(), now.getTime()));
      return {
        ...base,
        from: full.start.toISOString(),
        to: end.toISOString(),
        complete,
        reason: "no_mapping",
        dataStatus: null,
        tariff: null,
        mapping: null,
        bill: null,
      };
    }
    const readableAssets = await this.accessControl.readableAssetIds(jwt);
    if (readableAssets !== null && !readableAssets.includes(mapping.billingMeterAssetId)) {
      throw new NotFoundException(BILL_NOT_FOUND);
    }

    const [computed] = await this.bills.computeBills([{ mapping, month: target }], now);
    if (!computed) {
      throw new Error("computeBills returned no row for one target");
    }
    const version = computed.version;
    return {
      ...base,
      currency: mapping.currency,
      from: computed.window.start.toISOString(),
      to: computed.window.end.toISOString(),
      complete: computed.complete,
      reason: computed.ok ? null : computed.reason,
      dataStatus: version?.dataStatus ?? null,
      tariff:
        version === null
          ? null
          : {
              key: version.key,
              versionId: version.id,
              source: version.source,
              name: version.name,
              state: version.state,
              energyUnit: version.energyUnit,
              fixedBasis: version.fixedBasis,
              effectiveFrom: version.effectiveFrom,
              tariffOrder: version.tariffOrder,
              sourceUrl: version.sourceUrl,
            },
      mapping: {
        id: mapping.id,
        billingMeterAssetId: mapping.billingMeterAssetId,
        sanctionedLoad: mapping.sanctionedLoad,
        sanctionedLoadUnit: mapping.sanctionedLoadUnit,
      },
      bill: computed.ok
        ? {
            units: computed.units,
            unitType: computed.unitType,
            estimated: computed.estimated,
            overflowUnits: computed.bill.overflowUnits,
            slabLines: computed.bill.slabLines,
            energyCharge: computed.bill.energyCharge,
            highestSlabNo: computed.bill.highestSlabNo,
            fixedRate: computed.bill.fixedRate,
            fixedCharge: computed.bill.fixedCharge,
            wheelingCharge: computed.bill.wheelingCharge,
            total: computed.bill.total,
          }
        : null,
    };
  }
}
