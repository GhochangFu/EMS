import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";

import { assetPoints, assets } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload, ReportScheduleParams, ReportTemplateId, TrendPointsReportParams } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import { expandLocationSubtrees } from "../auth/location-tree";

/** The pairing check's two sentences (ADR 0108 Amendment 6 item 6; plan C17). */
export const TREND_POINTS_NEED_POINTS = "a trend_points schedule needs params.points";
export const ENERGY_TAKES_COMPARE_ONLY = "an energy_consumption schedule takes params.compare only";

/**
 * `F4.303` U11 — the template and its `params` arm must match: `trend_points` needs the trend arm,
 * `energy_consumption` takes the energy arm or nothing. A service check (400), not a refinement,
 * so the create body stays a plain `.strict()` object (the amendment's reason). Pure: it runs
 * before any read the pairing does not need.
 */
export function assertParamsMatchTemplate(templateId: ReportTemplateId, params: ReportScheduleParams | undefined): void {
  const trendArm = params !== undefined && "points" in params;
  if (templateId === "trend_points" && !trendArm) {
    throw new BadRequestException(TREND_POINTS_NEED_POINTS);
  }
  if (templateId === "energy_consumption" && trendArm) {
    throw new BadRequestException(ENERGY_TAKES_COMPARE_ONLY);
  }
}

/**
 * `F4.303` U11 (ADR 0108 Amendment 6 item 6, "Who may schedule a `trend_points` report"; plan
 * C17) — every `(asset, point)` pair of a `trend_points` schedule must name an asset of the
 * schedule's organization, at a location inside the subtree of `locationIds` (anywhere in the
 * organization when `[]`), readable by the author, with the code as an active registration.
 *
 * **Reads**, each once per call: one fleet select over `bms.assets` left-joined to its active
 * `bms.asset_points` rows for the named codes, bounded `a.organization_id = $org` and the named
 * asset ids (an asset of another organization returns no row, so the fleet pool never reads a
 * foreign row's location or codes); the subtree walk for a non-empty `locationIds`
 * (`expandLocationSubtrees`, bounded by the same organization); `readableAssetIds(jwt)`.
 *
 * **Order.** A repeated pair is refused first (pure, before any read). Then per index, in order:
 * no asset row → 400; outside the subtree → 400; not readable → 403; no active registration →
 * 400. Each sentence names the pair's index only — never an id the caller did not send back to
 * itself, and never an id at all.
 *
 * `ReportSchedulesService.create` calls it after `checkWriteScope` (so `locationIds` are already
 * the organization's and the author's) and before the tenant transaction; `update` calls it with
 * the stored points when a PATCH carries `locationIds` on a `trend_points` row.
 */
export async function assertTrendPointsSchedulable(
  deps: {
    readonly fleetDb: Pick<BmsDb, "select" | "execute">;
    readonly accessControl: Pick<AccessControlService, "readableAssetIds">;
  },
  jwt: JwtPayload,
  organizationId: string,
  locationIds: readonly string[],
  points: TrendPointsReportParams["points"],
): Promise<void> {
  const seen = new Set<string>();
  points.forEach((point, index) => {
    const key = `${point.assetId}|${point.pointKey}`;
    if (seen.has(key)) throw new BadRequestException(`point ${index} repeats an earlier point`);
    seen.add(key);
  });

  const assetIds = [...new Set(points.map((point) => point.assetId))];
  const pointKeys = [...new Set(points.map((point) => point.pointKey))];
  // fleetDb: bounded by the schedule's organization (already authorized by `checkWriteScope`) and the named ids.
  const rows = await deps.fleetDb
    .select({ assetId: assets.id, locationId: assets.locationId, pointKey: assetPoints.pointKey })
    .from(assets)
    .leftJoin(
      assetPoints,
      and(
        eq(assetPoints.assetId, assets.id),
        eq(assetPoints.organizationId, assets.organizationId),
        eq(assetPoints.active, true),
        inArray(assetPoints.pointKey, pointKeys),
      ),
    )
    .where(and(eq(assets.organizationId, organizationId), inArray(assets.id, assetIds)));

  const locationOf = new Map<string, string | null>();
  const registered = new Set<string>();
  for (const row of rows) {
    locationOf.set(row.assetId, row.locationId);
    if (row.pointKey !== null) registered.add(`${row.assetId}|${row.pointKey}`);
  }
  const subtree =
    locationIds.length === 0
      ? null
      : new Set(await expandLocationSubtrees(deps.fleetDb, { organizationIds: [organizationId], ids: locationIds }));
  const readable = await deps.accessControl.readableAssetIds(jwt);
  const readableSet = readable === null ? null : new Set(readable);

  points.forEach((point, index) => {
    if (!locationOf.has(point.assetId)) {
      throw new BadRequestException(`point ${index} names no asset of this organization`);
    }
    const locationId = locationOf.get(point.assetId) ?? null;
    if (subtree !== null && (locationId === null || !subtree.has(locationId))) {
      throw new BadRequestException(`point ${index} is not at a location of this schedule`);
    }
    if (readableSet !== null && !readableSet.has(point.assetId)) {
      throw new ForbiddenException(`point ${index} is outside your access scope`);
    }
    if (!registered.has(`${point.assetId}|${point.pointKey}`)) {
      throw new BadRequestException(`point ${index} is not registered on its asset`);
    }
  });
}
