import { useEffect, useState } from "react";

import { LocationKpiCard } from "./location-kpi-card";
import {
  orgSectionSummary,
  type OrganizationLocationGroup,
} from "../lib/location-kpi-groups";

type OrgLocationAccordionProps = {
  groups: OrganizationLocationGroup[];
};

/** Accordion grouping of location KPI cards by organization. */
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
            className="rounded-lg border border-line bg-surface"
          >
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-well"
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => toggleOrg(group.organization.id)}
            >
              <div>
                <div className="font-condensed text-sm font-bold text-ink">
                  {group.organization.code} · {group.organization.name}
                </div>
                <div className="mt-1 text-xs text-ink-muted">
                  {summary.locationCount} locations · {summary.totalKw.toFixed(1)} kW ·{" "}
                  {summary.openAlarms} alarms · {summary.freshLocationCount} live
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
              <div id={panelId} className="border-t border-well-deep bg-well/60 p-3">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {group.locations.map((location) => (
                    <LocationKpiCard key={location.id} location={location} />
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
