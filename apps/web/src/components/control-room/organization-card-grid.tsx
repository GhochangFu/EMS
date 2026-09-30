import type { LocationKpiSummary } from "@bms/shared";
import { Link } from "react-router-dom";

import { organizationCards } from "../../lib/control-room-levels";

type OrganizationCardGridProps = {
  /** The KPI list (`["dashboard","locations"]`); the grid groups it by organization. */
  items: readonly LocationKpiSummary[];
};

/**
 * `F3.66` (ADR 0076 decision 2), extracted by `F3.72` U1 (plan D2) — one card per readable
 * organization, each linking to its Control Room organization level. Moved verbatim from
 * `pages/control-room/organizations-page.tsx` so the estate can hold the same grid; the
 * `data-testid` is kept, and the level-skip decision stays with the page that renders it.
 */
export function OrganizationCardGrid({ items }: OrganizationCardGridProps) {
  return (
    <div
      data-testid="control-room-organizations"
      className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
    >
      {organizationCards(items).map((card) => (
        <Link
          key={card.organization.id}
          to={`/control-room/org/${card.organization.id}`}
          className="block surface-raised p-3 transition hover:text-accent-strong"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="font-condensed text-base font-bold text-ink">
              {card.organization.name}
            </div>
            <span className="rounded bg-canvas px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-neutral-ink">
              {card.organization.code}
            </span>
          </div>
          <div className="mt-2 text-xs text-ink-muted">
            {`${card.siteCount} sites · ${card.sitesOnline} online · ${card.openAlarms} alarms`}
          </div>
        </Link>
      ))}
    </div>
  );
}
