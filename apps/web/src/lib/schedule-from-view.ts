import { MAX_WIDGET_POINTS } from "@bms/shared";
import type { ReportScheduleParams, ReportTemplateId, SiteSegmentViewsDto } from "@bms/shared";

/**
 * `F4.303` U16 (ADR 0108 Amendment 6 item 6) — what a view hands the schedule wizard. The
 * Energy views schedule `energy_consumption` (the sites of the filter, `compare` on or off); the
 * point views (asset history, a segment sub-tab) schedule `trend_points` (the charted pairs and
 * `compare`). Each run reports the cadence period that just ended, not the range on screen, so
 * the prefill carries no range. Pure: no segment, organization or point is named here.
 */
export type SchedulePrefill = {
  readonly templateId: ReportTemplateId;
  readonly params: ReportScheduleParams | null;
  /** `[]` is the whole organization. */
  readonly locationIds: string[];
  /** Only where the view's own state names one (the Energy page); the site section does not. */
  readonly organizationId?: string;
};

/** The Energy page's filter, or the site section's one site: only the fields a schedule reads. */
export type EnergyScheduleSource = {
  readonly organizationId?: string;
  readonly locationIds: readonly string[];
  readonly compare?: "previous";
};

/** `energy_consumption` for the filter's sites; `compare` on when the filter compares. */
export function energySchedulePrefill(filter: EnergyScheduleSource): SchedulePrefill {
  return {
    templateId: "energy_consumption",
    params: { compare: filter.compare === "previous" },
    locationIds: [...filter.locationIds],
    ...(filter.organizationId === undefined ? {} : { organizationId: filter.organizationId }),
  };
}

function trendPointsPrefill(
  pairs: readonly { readonly assetId: string; readonly pointKey: string }[],
  locationId: string,
  compare: boolean,
): SchedulePrefill {
  return {
    templateId: "trend_points",
    params: {
      points: pairs.slice(0, MAX_WIDGET_POINTS).map((pair) => ({ assetId: pair.assetId, pointKey: pair.pointKey })),
      compare,
    },
    locationIds: [locationId],
  };
}

/** Asset history: the charted points on the asset, at the asset's location. */
export function historySchedulePrefill(
  asset: { readonly id: string; readonly locationId: string },
  range: { readonly compare: boolean },
  points: readonly string[],
): SchedulePrefill {
  return trendPointsPrefill(
    points.map((pointKey) => ({ assetId: asset.id, pointKey })),
    asset.locationId,
    range.compare,
  );
}

/**
 * A segment sub-tab: its drawn series only (`buckets !== null`), each on the sub-tab's point, at
 * the site. `null` when nothing is drawn: a `trend_points` schedule needs at least one point.
 */
export function segmentSchedulePrefill(
  locationId: string,
  data: SiteSegmentViewsDto,
  compare: boolean,
): SchedulePrefill | null {
  const point = data.point;
  const pairs =
    point === null
      ? []
      : data.ranking
          .filter((entry) => entry.buckets !== null)
          .map((entry) => ({ assetId: entry.assetId, pointKey: point.code }));
  return pairs.length === 0 ? null : trendPointsPrefill(pairs, locationId, compare);
}

/** The wizard's read-only line (Schedule and Review steps). */
export function scheduleTemplateLine(prefill: Pick<SchedulePrefill, "templateId" | "params">): string {
  const params = prefill.params;
  if (prefill.templateId === "trend_points") {
    const count = params !== null && "points" in params ? params.points.length : 0;
    return `Template: Trend points · ${count} ${count === 1 ? "point" : "points"}`;
  }
  return params !== null && params.compare ? "Template: Energy consumption · compare on" : "Template: Energy consumption";
}
