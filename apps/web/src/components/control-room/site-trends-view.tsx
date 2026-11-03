import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";

import type { SiteSegmentViewsDto, SiteSegmentViewsQuery } from "@bms/shared";

import { fetchSiteSegmentViews, isSegmentNotFound, segmentViewsQueryKey } from "../../api/segment-views";
import { ENERGY_VIEW, segmentViewsQueryOf } from "../../lib/site-trends";
import { siteTrendsPath } from "../../lib/smoc-pages";
import { type TrendsLink, trendsLinkFromSearch, trendsLinkToSearch } from "../../lib/view-links";
import { RangeCompareControls } from "../energy/range-compare-controls";
import { CopyLinkButton } from "../view-actions/copy-link-button";
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
 *
 * `F4.303` U6 (ADR 0108 Amendment 6 item 2): the range, its custom ends, compare and the site
 * ranking's `rankBy` live in the URL too (`trendsLinkFromSearch` / `trendsLinkToSearch`, the one
 * writer of this search), so the nav keeps them across sub-tabs and "Copy link" copies the view.
 */
export function SiteTrendsView({ locationId }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const link = trendsLinkFromSearch(searchParams);
  const { view, point, value, rankBy } = link;
  const write = (next: TrendsLink): void => {
    setSearchParams(new URLSearchParams(trendsLinkToSearch(next)), { replace: true });
  };

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
              to={`${sectionPath}${trendsLinkToSearch({ view: entry.key, value, rankBy })}`}
              aria-current={entry.key === view ? "page" : undefined}
              className={`surface-tab px-3 py-1.5 ${entry.key === view ? "surface-tab-selected" : ""}`}
            >
              {entry.label}
            </Link>
          ))}
        </nav>
        <div data-testid="site-trends-controls" className="flex flex-wrap items-end gap-3">
          <RangeCompareControls
            value={value}
            onChange={(next) => write({ ...link, value: next })}
            timeZone={data?.timeZone ?? null}
          />
          <div className="pb-1">
            <CopyLinkButton />
          </div>
        </div>
      </div>

      {view === ENERGY_VIEW ? (
        <SiteEnergyView
          locationId={locationId}
          value={value}
          rankBy={rankBy}
          onRankBy={(next) => write({ ...link, rankBy: next })}
        />
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
          onPoint={(code) => write({ ...link, point: code })}
        />
      )}
    </div>
  );
}
