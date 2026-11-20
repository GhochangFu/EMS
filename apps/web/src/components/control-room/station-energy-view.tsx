import type { LocationKpiSummary } from "@bms/shared";
import { Link, useSearchParams } from "react-router-dom";

import { useEnergyOrganizationViews } from "../../hooks/use-energy-organization-views";
import { FOCUS_OUTLINE_CLASS } from "../../lib/focus-classes";
import { ENERGY_VIEW, siteEnergyQueryOf } from "../../lib/site-trends";
import { siteTrendsPath } from "../../lib/smoc-pages";
import { type TrendsLink, trendsLinkFromSearch, trendsLinkToSearch } from "../../lib/view-links";
import { RangeCompareControls } from "../energy/range-compare-controls";
import { StationBills } from "../energy/station-bills";
import { SiteEnergyView } from "./site-energy-view";

type StationEnergyViewProps = {
  /** The station's id: the energy view reads its subtree (`locationIds=[station]`). */
  stationId: string;
  /** The station's sites, in the KPI list's order. */
  sites: readonly LocationKpiSummary[];
};

/**
 * `F4.240` part b (ADR 0140 decision 3f, plan Task 2.5) — the station's **Trends & Energy** tab.
 *
 * When any site shows energy: the range and compare controls, then `SiteEnergyView` at the station
 * (`/reports/energy/view` and `/reports/energy/organization-views` with `locationIds=[station]`,
 * reads that walk the subtree after refusing an unreadable node), with `StationBills` in its bill
 * slot: one bill per site that shows energy and their sum, so the station's own two-meter bill is
 * never read. The pickers' zone is the organization-views answer's (`useEnergyOrganizationViews`,
 * the energy view's own cache entry). The range, compare and `rankBy` live in the URL through
 * `trendsLinkFromSearch` / `trendsLinkToSearch`, the one writer of that search.
 *
 * Always: one **Trends** link per site to its own Trends & Energy tab. No `SiteTrendsView` and no
 * segment read at the station: segments are per site (decision 8 leaves a combined trend strip
 * out). No Export or Schedule (not in decision 3f). No code names a level, a type or an
 * organization (ADR 0098 decision 7).
 */
export function StationEnergyView({ stationId, sites }: StationEnergyViewProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const link = trendsLinkFromSearch(searchParams);
  const { value, rankBy } = link;
  const write = (next: TrendsLink): void => {
    setSearchParams(new URLSearchParams(trendsLinkToSearch(next)), { replace: true });
  };

  const energySites = sites.filter((entry) => entry.energyShown);
  const showsEnergy = energySites.length > 0;
  const query = showsEnergy ? siteEnergyQueryOf(stationId, value) : null;
  const orgViewsQ = useEnergyOrganizationViews(query);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <nav aria-label="Site trends" className="flex flex-wrap items-center gap-3 text-sm">
          {sites.map((entry) => (
            <span key={entry.id} className="flex items-center gap-1.5">
              <span className="text-ink">{entry.name}</span>
              <Link
                to={siteTrendsPath(entry.id)}
                aria-label={`Open ${entry.name} trends`}
                className={`surface-button px-2.5 py-1 ${FOCUS_OUTLINE_CLASS}`}
              >
                Trends
              </Link>
            </span>
          ))}
        </nav>
        {showsEnergy ? (
          <RangeCompareControls
            value={value}
            onChange={(next) => write({ view: ENERGY_VIEW, value: next, rankBy })}
            timeZone={orgViewsQ.data?.timeZone ?? null}
          />
        ) : null}
      </div>
      {showsEnergy ? (
        <SiteEnergyView
          locationId={stationId}
          value={value}
          rankBy={rankBy}
          onRankBy={(next) => write({ view: ENERGY_VIEW, value, rankBy: next })}
          billSlot={<StationBills sites={energySites} />}
        />
      ) : null}
    </div>
  );
}
