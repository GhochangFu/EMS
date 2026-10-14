import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { AccessLocation } from "@bms/shared";

import { fetchMapSites } from "../../api/map";
import { controlRoomSiteLink, organizationPins } from "../../lib/map-site";
import { MapSubtreeFilter } from "../map-subtree-filter";
import { SectionCard } from "../section-card";
import { WorldMap } from "../world-map";

type OrganizationSiteMapProps = {
  organizationId: string;
  /** `F2.10` (ADR 0098 B12) — this organization's readable nodes, for the parent filter. */
  nodes: readonly AccessLocation[];
  /**
   * `F4.260` — when the page's site read last landed (its `dataUpdatedAt`). The map re-reads
   * each time it changes, so the pins and the site cards change together; it has no timer of
   * its own.
   */
  syncedAt: number;
};

/**
 * `F3.79` — the Control Room organization level's site map: `GET /map/sites` narrowed to this
 * organization's pins (`organizationPins`), so the map opens on its sites and on no other
 * organization's. The closest mockup renderer is `R.wm` ("World Map (OpenStreetMap)",
 * `ESKOM_SMOC.html`). It shares the `["map","sites"]` read with the Sites map and opens no socket.
 * `F4.260`: it re-reads when the page's site read lands (`syncedAt`), not on a timer of its own,
 * so a pin and its site card do not sit out of step for up to one poll.
 *
 * A pin's popup opens the next drill-down level, the site's overview (`controlRoomSiteLink`).
 * Scroll-wheel zoom is off, so a page scroll over the card does not zoom the map. The map fits
 * its box once (`FitToSites`), so the page keys this card by `organizationId`: a move to another
 * organization mounts a new map that fits the new box. For the same reason a failed poll after a
 * good read keeps the map (TanStack keeps `data`): the error line is only for a read that never
 * succeeded, since a remount would fit the box again and drop the user's pan and zoom.
 *
 * `F2.10` (ADR 0098 decision 11, B12) — a parent filter zooms to a subtree: the server narrows
 * the pins, and the map is keyed by the filter so it fits the subtree's box.
 */
export function OrganizationSiteMap({ organizationId, nodes, syncedAt }: OrganizationSiteMapProps) {
  const [rootId, setRootId] = useState<string | null>(null);
  const rootName = nodes.find((n) => n.id === rootId)?.name ?? null;
  const query = useQuery({
    queryKey: ["map", "sites", rootId],
    queryFn: () => fetchMapSites(rootId ?? undefined),
    refetchInterval: false,
  });
  // `F4.260` — re-read on each new site read. On mount this call joins the first read rather
  // than starting a second (S9 counts one).
  const { refetch } = query;
  useEffect(() => {
    void refetch();
  }, [syncedAt, refetch]);
  const pins = query.data ? organizationPins(query.data, organizationId) : [];

  return (
    <SectionCard
      title="Site map"
      subtitle={query.data ? `${pins.length} sites · OpenStreetMap` : "OpenStreetMap"}
      bodyClassName={pins.length > 0 ? "p-0" : "p-4"}
      actions={<MapSubtreeFilter nodes={nodes} value={rootId} onChange={setRootId} />}
    >
      {query.isPending ? (
        <p role="status" className="text-sm text-ink-muted">
          Loading site map…
        </p>
      ) : query.isError && query.data === undefined ? (
        <p className="text-sm text-critical-ink">The site map could not be read.</p>
      ) : pins.length === 0 && rootId !== null ? (
        <p className="text-sm text-ink-muted">{`No map pin under ${rootName ?? "this location"}.`}</p>
      ) : pins.length === 0 ? (
        <p className="text-sm text-ink-muted">No map positions for this organization's sites.</p>
      ) : (
        <WorldMap
          key={rootId ?? "all"}
          sites={pins}
          siteLink={controlRoomSiteLink}
          heightClassName="h-[min(50vh,360px)]"
          scrollWheelZoom={false}
        />
      )}
    </SectionCard>
  );
}
