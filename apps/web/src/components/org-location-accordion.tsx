import { useEffect, useState } from "react";

import { LiveCountChips } from "./control-room/live-count-chips";
import { SiteCardGroups } from "./control-room/site-card-groups";
import {
  groupSitesByParent,
  orgSectionSummary,
  type OrganizationLocationGroup,
} from "../lib/location-kpi-groups";

type OrgLocationAccordionProps = {
  groups: OrganizationLocationGroup[];
};

/**
 * Accordion grouping of location KPI cards by organization. `F4.261` — each header shows the
 * organization's live and not-live chips (`LiveCountChips`) instead of a small "N live".
 *
 * `F4.240` (ADR 0139, owner ruling Q1) — each organization's cards are grouped under their parent
 * (`SiteCardGroups`, no `onSelectParent`: this page has no parent-filtered map, so the header is a
 * heading), and the line counts sites (`{n} sites`), so an asset-less parent is neither a card nor
 * a count.
 */
export function OrgLocationAccordion({ groups }: OrgLocationAccordionProps) {
  const [expandedOrgIds, setExpandedOrgIds] = useState<Set<string>>(
    () => new Set(groups.map((group) => group.organization.id)),
  );

  useEffect(() => {
    setExpandedOrgIds(new Set(groups.map((group) => group.organization.id)));
  }, [groups]);

  function toggleOrg(orgId: string): void {
    setExpandedOrgIds((current) => {
      const next = new Set(current);
      if (next.has(orgId)) {
        next.delete(orgId);
      } else {
        next.add(orgId);
      }
      return next;
    });
  }

  if (groups.length === 0) {
    return (
      <div className="text-sm text-ink-muted">
        No locations in this organization for your access scope.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const summary = orgSectionSummary(group.locations);
        const expanded = expandedOrgIds.has(group.organization.id);
        const panelId = `org-panel-${group.organization.id}`;

        return (
          <section
            key={group.organization.id}
            className="surface-raised"
          >
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:text-ink"
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => toggleOrg(group.organization.id)}
            >
              <div>
                <div className="font-condensed text-sm font-bold text-ink">
                  {group.organization.code} · {group.organization.name}
                </div>
                <div className="mt-1 text-xs text-ink-muted">
                  {summary.locationCount} sites ·{" "}
                  {summary.totalKw === null ? "" : `${summary.totalKw.toFixed(1)} kW · `}
                  {summary.openAlarms} alarms
                </div>
                <div className="mt-2 max-w-xs">
                  <LiveCountChips
                    live={summary.freshLocationCount}
                    notLive={summary.locationCount - summary.freshLocationCount}
                  />
                </div>
              </div>
              <span
                className={`text-sm font-semibold text-ink-muted transition-transform ${
                  expanded ? "rotate-180" : ""
                }`}
                aria-hidden
              >
                ▼
              </span>
            </button>
            {expanded ? (
              <div id={panelId} className="space-y-3 border-t border-well-deep bg-well/60 p-3">
                <SiteCardGroups
                  grouped={groupSitesByParent(group.locations)}
                  gridClassName="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
                />
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
