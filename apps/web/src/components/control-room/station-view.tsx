import type { LocationKpiSummary } from "@bms/shared";
import { Link } from "react-router-dom";

import { sectionKw, siteGroupRollupText, type SiteCardGroup } from "../../lib/location-kpi-groups";
import { siteAssetsPath } from "../../lib/smoc-pages";
import { HealthBadActorsCard } from "../asset-health/health-bad-actors-card";
import { DegradationTrendCard } from "../degradation/degradation-trend-card";
import { MlFindingsCard } from "../ml/ml-findings-card";
import { SectionCard } from "../section-card";
import { ActiveAlarmsRail } from "./active-alarms-rail";
import { ScopedDashboardsList } from "./scoped-dashboards-list";
import { SiteCardGroups } from "./site-card-groups";

/** The station's findings card shows both kinds, as the site body's does (`E1.9e`). */
const STATION_FINDINGS_KINDS = ["anomalies", "forecasts"] as const;

type StationViewProps = {
  /** The station's own KPI item: a location that holds no asset (`stationGroupOf`). */
  station: LocationKpiSummary;
  /** `stationGroupOf`'s group: the station and the sites under it, in the list's order. */
  group: SiteCardGroup;
  /** The page's section: the bare path (`view`) or `/assets`. */
  section: "view" | "assets";
};

/**
 * `F4.240` part b (ADR 0140 decisions 1–4, plan D2, D5–D7) — the site page's body at a station.
 *
 * The **view** section: the totals line (the organization page's header sentence,
 * `siteGroupRollupText`, plus ` · <kW> kW` from `sectionKw` over the sites, one decimal, left out
 * when no site has a number); the site cards beside the station's active alarms
 * (`ActiveAlarmsRail` by `locationId`: the station and every site under it); the three advisory
 * cards scoped to the station (each read walks the subtree, decision 3g); and the station's
 * dashboards without its old template copy (`omitTemplateCopies`, decision 3h, ruling Q1 (a)).
 *
 * The **assets** section lists the sites from the KPI items, each linking to its own Assets & RTUs
 * page; it makes no read (decision 3d). No notice, no layout wizard, no wall, no bill, no generated
 * view: each would read or write at the station itself (decisions 3, 5). Every figure comes from
 * the items the page already holds, so no code names a level, a type or an organization (ADR 0098
 * decision 7).
 */
export function StationView({ station, group, section }: StationViewProps) {
  if (section === "assets") {
    return <StationAssets sites={group.sites} />;
  }
  const kw = sectionKw(group.sites);
  return (
    <>
      <p data-testid="station-totals" className="text-sm text-ink-muted">
        {`${siteGroupRollupText(group)}${kw === null ? "" : ` · ${kw.toFixed(1)} kW`}`}
      </p>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="space-y-3">
          <SiteCardGroups grouped={{ groups: [], loose: group.sites }} />
        </div>
        <ActiveAlarmsRail locationId={station.id} />
      </div>
      <MlFindingsCard
        kinds={STATION_FINDINGS_KINDS}
        scope={{ organizationId: station.organization.id, locationId: station.id }}
        compact
      />
      <HealthBadActorsCard organizationId={station.organization.id} locationId={station.id} showCount />
      <DegradationTrendCard organizationId={station.organization.id} locationId={station.id} />
      <ScopedDashboardsList locationId={station.id} organizationId={station.organization.id} omitTemplateCopies />
    </>
  );
}

/** `F4.240` part b (ADR 0140 decision 3d) — the sites' Assets & RTUs entries, from the KPI items. */
function StationAssets({ sites }: { sites: readonly LocationKpiSummary[] }) {
  return (
    <SectionCard title="Assets & RTUs" bodyClassName="p-3">
      <ul className="divide-y divide-well-deep">
        {sites.map((site) => (
          <li key={site.id} data-testid="station-site-row" className="flex items-center justify-between gap-3 py-2">
            <span className="text-sm">
              <span className="font-semibold text-ink">{site.name}</span>{" "}
              <span className="text-ink-muted">{`${site.rtuCount} RTUs · ${site.assetCount} assets`}</span>
            </span>
            <Link
              to={siteAssetsPath(site.id)}
              aria-label={`Open ${site.name} assets and RTUs`}
              className="surface-button px-2.5 py-1"
            >
              Open
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
