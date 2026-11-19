import type { LocationKpiSummary } from "@bms/shared";

import { siteGroupRollup, type GroupedSites, type SiteCardGroup } from "../../lib/location-kpi-groups";
import { LocationKpiCard } from "../location-kpi-card";

type SiteCardGroupsProps = {
  /** `groupSitesByParent` over the sites to draw (or one half of `splitGroupsByLive`). */
  grouped: GroupedSites;
  /**
   * The organization page's map filter (plan D12): with it each header is a button that hands
   * its parent's id over. Omit it where there is no parent-filtered map (the estate page, Q1):
   * the header is then a heading and not a click.
   */
  onSelectParent?: (parentId: string) => void;
  /** The parent the map is filtered to; its header reads `aria-pressed="true"`. */
  selectedParentId?: string | null;
  /** The card grid's classes; the organization page and the estate page lay out differently. */
  gridClassName?: string;
};

const DEFAULT_GRID = "grid content-start gap-3 md:grid-cols-2";

/**
 * `F4.240` (ADR 0139 decisions 13–14, plan D11–D12) — site cards grouped under their parent. The
 * loose sites (no readable parent) come first as plain `LocationKpiCard`s, exactly as a flat list
 * renders today; then each group: a header naming the parent with its roll-up
 * (`{live} of {total} sites live · {assets} assets · {alarms} alarms`) over the group's cards. A
 * parent that holds no asset draws no card; one that does draws its own card first. The header
 * links to no station page. No new colour or token.
 */
export function SiteCardGroups({
  grouped,
  onSelectParent,
  selectedParentId = null,
  gridClassName = DEFAULT_GRID,
}: SiteCardGroupsProps) {
  return (
    <>
      {grouped.loose.length > 0 ? <CardGrid className={gridClassName} sites={grouped.loose} /> : null}
      {grouped.groups.map((group) => (
        <div key={group.parent.id} data-testid={`site-group-${group.parent.id}`} className="space-y-2">
          <GroupHeader
            group={group}
            onSelectParent={onSelectParent}
            pressed={selectedParentId === group.parent.id}
          />
          <CardGrid className={gridClassName} sites={group.sites} />
        </div>
      ))}
    </>
  );
}

function CardGrid({ className, sites }: { className: string; sites: readonly LocationKpiSummary[] }) {
  return (
    <div className={className}>
      {sites.map((location) => (
        <LocationKpiCard key={location.id} location={location} />
      ))}
    </div>
  );
}

type GroupHeaderProps = {
  group: SiteCardGroup;
  onSelectParent?: (parentId: string) => void;
  pressed: boolean;
};

/** `F4.240` (plan D12) — a button on the organization page, a heading elsewhere. */
function GroupHeader({ group, onSelectParent, pressed }: GroupHeaderProps) {
  const rollup = siteGroupRollup(group);
  const body = (
    <>
      <span data-testid="site-group-name" className="font-condensed text-sm font-bold">
        {group.parent.name}
      </span>
      <span data-testid="site-group-rollup" className="text-xs font-normal text-ink-muted">
        {`${rollup.liveSites} of ${rollup.sites} sites live · ${rollup.assets} assets · ${rollup.alarms} alarms`}
      </span>
    </>
  );
  const layout = "flex w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-well-deep pb-1 text-left";

  if (onSelectParent === undefined) {
    return <h3 className={`${layout} text-ink`}>{body}</h3>;
  }
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={`Show ${group.parent.name} on the site map`}
      className={`${layout} transition hover:text-accent-strong ${pressed ? "text-accent-strong" : "text-ink"}`}
      onClick={() => onSelectParent(group.parent.id)}
    >
      {body}
    </button>
  );
}
