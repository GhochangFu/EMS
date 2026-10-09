import { useQuery } from "@tanstack/react-query";

import { fetchMapSites } from "../../api/map";
import { controlRoomSiteLink, organizationPins } from "../../lib/map-site";
import { SectionCard } from "../section-card";
import { WorldMap } from "../world-map";

type OrganizationSiteMapProps = {
  organizationId: string;
};

/**
 * `F3.79` — the Control Room organization level's site map: `GET /map/sites` narrowed to this
 * organization's pins (`organizationPins`), so the map opens on its sites and on no other
 * organization's. The closest mockup renderer is `R.wm` ("World Map (OpenStreetMap)",
 * `ESKOM_SMOC.html`). It shares the `["map","sites"]` read with the Sites map and re-reads every
 * 8 s, as that page does; it opens no socket, since the organization page already polls.
 *
 * A pin's popup opens the next drill-down level, the site's overview (`controlRoomSiteLink`).
 * Scroll-wheel zoom is off, so a page scroll over the card does not zoom the map. The map fits
 * its box once (`FitToSites`), so the page keys this card by `organizationId`: a move to another
 * organization mounts a new map that fits the new box. For the same reason a failed poll after a
 * good read keeps the map (TanStack keeps `data`): the error line is only for a read that never
 * succeeded, since a remount would fit the box again and drop the user's pan and zoom.
 */
export function OrganizationSiteMap({ organizationId }: OrganizationSiteMapProps) {
  const query = useQuery({
    queryKey: ["map", "sites"],
    queryFn: () => fetchMapSites(),
    refetchInterval: 8000,
  });
  const pins = query.data ? organizationPins(query.data, organizationId) : [];

  return (
    <SectionCard
      title="Site map"
      subtitle={query.data ? `${pins.length} sites · OpenStreetMap` : "OpenStreetMap"}
      bodyClassName={pins.length > 0 ? "p-0" : "p-4"}
    >
      {query.isPending ? (
        <p role="status" className="text-sm text-ink-muted">
          Loading site map…
        </p>
      ) : query.isError && query.data === undefined ? (
        <p className="text-sm text-critical-ink">The site map could not be read.</p>
      ) : pins.length === 0 ? (
        <p className="text-sm text-ink-muted">No map positions for this organization's sites.</p>
      ) : (
        <WorldMap
          sites={pins}
          siteLink={controlRoomSiteLink}
          heightClassName="h-[min(50vh,360px)]"
          scrollWheelZoom={false}
        />
      )}
    </SectionCard>
  );
}
