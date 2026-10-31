import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import type { Pool } from "pg";

import { locations, organizations } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  AggregateLevel,
  EnergyFilterOptions,
  EnergyView,
  EnergyViewPartial,
  EnergyViewPeriod,
  EnergyViewQuery,
  JwtPayload,
} from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { expandLocationSubtrees } from "../auth/location-tree";
import { CalcParametersService } from "../calc/calc-parameters.service";
import { FLEET_DRIZZLE, FLEET_POOL } from "../database/database.tokens";
import { energyCost, perAssetEnergy, resolveTariffs } from "../telemetry/energy-cost";
import { nominalSourceSplit } from "../telemetry/energy-sources";
import { bucketHours } from "../telemetry/point-aggregates";
import { windowedPueRatio } from "../telemetry/pue-ratio";
import { nullUnreadableParents } from "./energy-filter-options";
import { partialCoverage } from "./energy-view-partial";
import {
  displayBucketFor,
  levelAndBucketFor,
  previousPeriod,
  resolveEnergyRange,
  zoneForArithmetic,
  type EnergyViewPeriodRange,
} from "./energy-view-range";
import { averagePf, energyPeriodRead, viewTopConsumers } from "./energy-view-read";
import { ReportScopeService } from "./report-scope";

/** A global admin (or a caller of several organizations) names nothing: there is no fleet-wide view. */
export const ENERGY_VIEW_ORGANIZATION_REQUIRED = "organizationId is required: the energy view reads one organization";

/** Readable locations that do not lie in the named `organizationId`. */
export const ENERGY_VIEW_ORGANIZATION_MISMATCH = "locationIds names locations outside organizationId";

/** An `organizationId` the caller does not read. */
export const ENERGY_VIEW_ORGANIZATION_OUTSIDE_SCOPE = "organizationId is outside your access scope";

/** A global admin's `organizationId` that names no organization. */
export const ENERGY_VIEW_ORGANIZATION_NOT_FOUND = "organizationId names no organization";

const TOP_CONSUMERS = 10;

type Place = { readonly organizationId: string; readonly assetIds: readonly string[] };

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * `F4.298` U4 (ADR 0108 decision 2) — the Energy page's filter and KPI view,
 * `GET /reports/energy/view`, and its filter source,
 * `GET /reports/energy/filter-options`.
 *
 * **Order of the checks (decision 2.2).** Named locations resolve first, with
 * their grant check (`ReportScopeService.placeForCaller`): a location the
 * caller cannot read is a 403 before any organization is compared. Only then
 * is a given `organizationId` compared (a 400 on a mismatch). With no
 * locations the caller must read the organization (403), and with neither, a
 * caller of exactly one organization gets that one; anyone else a 400.
 *
 * **Access before read (decision 2.5).** Every telemetry read takes the
 * resolved list, never `null`: a global admin resolves to the organization's
 * explicit list (`readableAssetIdsInOrganization`). An empty list reads
 * nothing — each read returns its empty result before a statement.
 *
 * Telemetry runs on the fleet pool (`ReportsService`'s reason: every read
 * joins the FORCE-policied `bms.assets`, and the asset list is the isolation
 * control). Cost and PUE per period exactly as `ReportsService.energySummary`.
 *
 * Provided by `ReportsModule`, never the loop-free core: it injects
 * `ReportScopeService`, whose `LocationAssetScopeService` comes from the
 * `@Global()` `AuthModule` the worker does not import.
 */
@Injectable()
export class EnergyViewService {
  constructor(
    @Inject(FLEET_POOL) private readonly pool: Pool,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: Pick<BmsDb, "select" | "execute">,
    @Inject(CalcParametersService)
    private readonly parameters: Pick<CalcParametersService, "resolveForAssets">,
    @Inject(AccessControlService)
    private readonly access: Pick<
      AccessControlService,
      "readableAssetIdsInOrganization" | "readableOrganizationIds" | "readableLocationIds"
    >,
    @Inject(ReportScopeService) private readonly scope: Pick<ReportScopeService, "placeForCaller">,
  ) {}

  async view(user: JwtPayload, query: EnergyViewQuery): Promise<EnergyView> {
    const named = query.locationIds;
    const place = await this.placeFor(user, query);
    const zone = zoneForArithmetic(
      named?.length === 1 ? await this.locationZone(place.organizationId, named[0] as string) : null,
      await this.organizationZone(place.organizationId),
    );

    const now = new Date();
    const current = resolveEnergyRange(query, zone, now);
    const previous = query.compare === "previous" ? previousPeriod(current) : null;
    const { level, bucket } = levelAndBucketFor({
      bucket: displayBucketFor(current.durationHours),
      olderStart: (previous ?? current).start,
      now,
    });

    const partial = await this.partialFor(user, place.organizationId, named);
    const read = (range: EnergyViewPeriodRange) =>
      this.period({ level, bucket, timeZone: zone.arithmeticZone, range, assetIds: place.assetIds });
    const currentPeriod = await read(current);
    const comparePeriod = previous === null ? null : await read(previous);
    const topConsumers = await viewTopConsumers(this.pool, {
      level,
      start: current.start,
      end: current.end,
      durationHours: current.durationHours,
      limit: TOP_CONSUMERS,
      assetIds: place.assetIds,
    });

    return {
      organizationId: place.organizationId,
      timeZone: zone.timeZone,
      generatedAt: new Date().toISOString(),
      level,
      bucket,
      current: currentPeriod,
      compare: comparePeriod,
      topConsumers,
      partial,
    };
  }

  /** The caller's readable organizations and their readable locations, for every role (decision 2.7). */
  async filterOptions(user: JwtPayload): Promise<EnergyFilterOptions> {
    const organizationIds = await this.access.readableOrganizationIds(user);
    if (organizationIds !== null && organizationIds.length === 0) return { organizations: [], locations: [] };
    // fleetDb: pre-tenant scope resolution (ADR 0043 Amendment 2/3), bounded by the caller's own ids.
    const organizationRows = await this.fleetDb
      .select({ id: organizations.id, code: organizations.code, name: organizations.name })
      .from(organizations)
      .where(
        organizationIds === null
          ? eq(organizations.active, true)
          : and(eq(organizations.active, true), inArray(organizations.id, organizationIds)),
      );
    if (organizationRows.length === 0) return { organizations: [], locations: [] };

    const locationIds = await this.access.readableLocationIds(user);
    if (locationIds !== null && locationIds.length === 0) return { organizations: organizationRows, locations: [] };
    const inOrganizations = and(
      eq(locations.active, true),
      inArray(
        locations.organizationId,
        organizationRows.map((row) => row.id),
      ),
    );
    const locationRows = await this.fleetDb
      .select({
        id: locations.id,
        name: locations.name,
        parentId: locations.parentId,
        organizationId: locations.organizationId,
      })
      .from(locations)
      .where(locationIds === null ? inOrganizations : and(inOrganizations, inArray(locations.id, locationIds)));
    return { organizations: organizationRows, locations: nullUnreadableParents(locationRows) };
  }

  /** Decision 2.2, in its order: the named locations (and their grant), then the organization. */
  private async placeFor(user: JwtPayload, query: EnergyViewQuery): Promise<Place> {
    if (query.locationIds !== undefined && query.locationIds.length > 0) {
      const place = await this.scope.placeForCaller(user, query.locationIds);
      if (query.organizationId !== undefined && query.organizationId !== place.organizationId) {
        throw new BadRequestException(ENERGY_VIEW_ORGANIZATION_MISMATCH);
      }
      return place;
    }
    const readable = await this.access.readableOrganizationIds(user);
    let organizationId = query.organizationId;
    if (organizationId === undefined) {
      if (readable === null || readable.length !== 1) throw new BadRequestException(ENERGY_VIEW_ORGANIZATION_REQUIRED);
      organizationId = readable[0] as string;
    } else if (readable !== null && !readable.includes(organizationId)) {
      throw new ForbiddenException(ENERGY_VIEW_ORGANIZATION_OUTSIDE_SCOPE);
    }
    return { organizationId, assetIds: await this.access.readableAssetIdsInOrganization(user, organizationId) };
  }

  /** fleetDb: the organization's stored zone; the place resolved it from the caller's scope first. */
  private async organizationZone(organizationId: string): Promise<string | null> {
    const rows = await this.fleetDb
      .select({ timezone: organizations.timezone })
      .from(organizations)
      .where(eq(organizations.id, organizationId));
    if (rows.length === 0) throw new BadRequestException(ENERGY_VIEW_ORGANIZATION_NOT_FOUND);
    return rows[0]?.timezone ?? null;
  }

  /** fleetDb: the one named location's stored zone, bounded to the placed organization. */
  private async locationZone(organizationId: string, locationId: string): Promise<string | null> {
    const rows = await this.fleetDb
      .select({ timezone: locations.timezone })
      .from(locations)
      .where(and(eq(locations.id, locationId), eq(locations.organizationId, organizationId)));
    return rows[0]?.timezone ?? null;
  }

  /**
   * Decision 2.9: the named locations' subtree, or the organization's active
   * locations, counted against the caller's readable locations. Two counts,
   * never an id; `null` for a caller who reads every location.
   */
  private async partialFor(
    user: JwtPayload,
    organizationId: string,
    named: readonly string[] | undefined,
  ): Promise<EnergyViewPartial | null> {
    const readable = await this.access.readableLocationIds(user);
    if (readable === null) return null;
    const selected =
      named !== undefined && named.length > 0
        ? await expandLocationSubtrees(this.fleetDb, { organizationIds: [organizationId], ids: named })
        : (
            await this.fleetDb
              .select({ id: locations.id })
              .from(locations)
              .where(and(eq(locations.organizationId, organizationId), eq(locations.active, true)))
          ).map((row) => row.id);
    return partialCoverage(selected, readable);
  }

  /** One period's KPIs: the reads of `energy-view-read.ts`, then cost and PUE as `ReportsService.energySummary`. */
  private async period({
    level,
    bucket,
    timeZone,
    range,
    assetIds,
  }: {
    level: AggregateLevel;
    bucket: AggregateLevel;
    timeZone: string;
    range: EnergyViewPeriodRange;
    assetIds: readonly string[];
  }): Promise<EnergyViewPeriod> {
    const { start, end } = range;
    const read = await energyPeriodRead(this.pool, { level, bucket, timeZone, start, end, assetIds });
    const avgPf = await averagePf(this.pool, { level, start, end, assetIds });
    const { dg, grid } = nominalSourceSplit(read.totalKwh, read.solarKwh);
    let pueEstimate: number | null = null;
    let cost: { indicativeCost: number | null; tariffPerKwh: number | null; currency: string | null } = {
      indicativeCost: null,
      tariffPerKwh: null,
      currency: null,
    };
    if (assetIds.length > 0) {
      const perAsset = await perAssetEnergy(this.pool, {
        level,
        window: { kind: "range", start, end },
        kwhFactor: bucketHours(level),
        assetIds,
      });
      cost = energyCost(perAsset, await resolveTariffs(this.parameters, perAsset, end));
      pueEstimate = await windowedPueRatio(this.pool, { level, start, end, assetIds: [...assetIds] });
    }
    return {
      from: start.toISOString(),
      to: end.toISOString(),
      durationHours: range.durationHours,
      hasData: read.hasData,
      totalKwh: round(read.totalKwh, 2),
      peakKw: round(read.peakKw, 2),
      peakAt: read.peakAt,
      avgPf: avgPf === null ? null : round(avgPf, 3),
      pueEstimate,
      ...cost,
      sourceTotals: { solarKwh: round(read.solarKwh, 2), dgKwh: round(dg, 2), gridKwh: round(grid, 2) },
      series: read.series,
    };
  }
}
