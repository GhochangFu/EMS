import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import type { SiteSegmentViewsDto, SiteSegmentViewsQuery } from "@bms/shared";

import { fetchSiteSegmentViews, isSegmentNotFound, segmentViewsQueryKey } from "../../api/segment-views";
import {
  ENERGY_VIEW,
  pointFromSearch,
  segmentViewsQueryOf,
  trendsSearch,
  viewFromSearch,
} from "../../lib/site-trends";
import { siteTrendsPath } from "../../lib/smoc-pages";
import { RangeCompareControls, type RangeCompareValue } from "../energy/range-compare-controls";
import { SegmentView } from "./segment-view";
import { SiteEnergyView } from "./site-energy-view";

type Props = {
  locationId: string;
};

function segmentViewsOf(locationId: string, query: SiteSegmentViewsQuery | null): Promise<SiteSegmentViewsDto> {
  // Unreachable: the query is disabled while `query` is null.
  return query === null ? Promise.reject(new Error("no segment views query")) : fetchSiteSegmentViews(locationId, query);
}

/**
 * `F4.302` U4 (ADR 0108 Amendment 4 items 2, 3, 8) — the site page's **Trends & Energy**
 * section. Its own nav lists **Energy** first, then one entry per segment present at the site,
 * taken from the segment read's `segments` — so one segment read runs on the Energy sub-tab too,
 * with the default segment, and no code names a segment. `?view=energy|<domain>` and `&point=`
 * hold the selection (ids and codes only); the range and compare are the section's state, shared
 * by both kinds of sub-tab and read in the site's zone. Every failure is a fixed sentence.
 */
export function SiteTrendsView({ locationId }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = viewFromSearch(searchParams);
  const point = pointFromSearch(searchParams);
  const [value, setValue] = useState<RangeCompareValue>({ range: "24h" });

  const query = segmentViewsQueryOf(view, point, value);
  const segmentQ = useQuery({
    queryKey: query === null ? ["control-room", "segment-views", locationId, null] : segmentViewsQueryKey(locationId, query),
    queryFn: () => segmentViewsOf(locationId, query),
    enabled: query !== null,
    // The previous answer holds the nav steady while another segment or point of this site
    // loads; never across sites — the router keeps this view mounted on a site switch, and the
    // nav and the pickers' zone would show the previous site's segments and zone.
    placeholderData: (previous) => (previous?.locationId === locationId ? previous : undefined),
    refetchInterval: 60_000,
  });
  const data = segmentQ.data;
  const sectionPath = siteTrendsPath(locationId);
  const entries = [
    { key: ENERGY_VIEW, label: "Energy" },
    ...(data?.segments ?? []).map((segment) => ({ key: segment.domain, label: segment.label })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <nav aria-label="Trends sections" className="flex flex-wrap gap-1">
          {entries.map((entry) => (
            <Link
              key={entry.key}
              to={`${sectionPath}${trendsSearch(entry.key)}`}
              aria-current={entry.key === view ? "page" : undefined}
              className={`surface-tab px-3 py-1.5 ${entry.key === view ? "surface-tab-selected" : ""}`}
            >
              {entry.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-end gap-3">
          <RangeCompareControls value={value} onChange={setValue} timeZone={data?.timeZone ?? null} />
        </div>
      </div>

      {view === ENERGY_VIEW ? (
        <SiteEnergyView locationId={locationId} value={value} />
      ) : segmentQ.isError && (data === undefined || segmentQ.isPlaceholderData) ? (
        <p role="alert" className="text-sm text-critical-ink">
          {isSegmentNotFound(segmentQ.error)
            ? "This segment or point is not at this site."
            : "Could not load this segment's trends."}
        </p>
      ) : data === undefined || segmentQ.isPlaceholderData ? (
        <p role="status" className="text-sm text-ink-muted">
          Loading the segment trends…
        </p>
      ) : (
        <SegmentView
          data={data}
          onPoint={(code) => setSearchParams(new URLSearchParams(trendsSearch(view, code)))}
        />
      )}
    </div>
  );
}
