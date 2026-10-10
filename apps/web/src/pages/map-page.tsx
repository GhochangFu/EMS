import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";

import { fetchMapSites } from "../api/map";
import { MapSubtreeFilter } from "../components/map-subtree-filter";
import { PageHeader } from "../components/page-header";
import { SectionCard } from "../components/section-card";
import { WorldMap } from "../components/world-map";
import { AppShell } from "../layouts/app-shell";
import { estateSiteLink } from "../lib/map-site";
import { socketBaseUrl } from "../lib/socket-url";
import { useAuthStore, type AuthUser } from "../stores/auth-store";

type MapPageProps = {
  user: AuthUser;
};

export function MapPage({ user }: MapPageProps) {
  const qc = useQueryClient();
  const accessToken = useAuthStore((state) => state.accessToken);
  // `F2.10` (ADR 0098 decision 11, B12) — a parent narrows the pins to its subtree on the server.
  // The key keeps the `["map","sites"]` prefix, so the socket's invalidation still matches it.
  const nodes = useAuthStore((state) => state.scope)?.locations ?? [];
  const [rootId, setRootId] = useState<string | null>(null);
  const rootName = nodes.find((n) => n.id === rootId)?.name ?? null;
  const q = useQuery({
    queryKey: ["map", "sites", rootId],
    queryFn: () => fetchMapSites(rootId ?? undefined),
    refetchInterval: 8000,
  });

  useEffect(() => {
    const base = socketBaseUrl();
    const sockets: Socket[] = [
      io(`${base}/ws/telemetry`, {
        transports: ["websocket"],
        auth: { token: accessToken },
      }),
      io(`${base}/ws/alarms`, {
        transports: ["websocket"],
        auth: { token: accessToken },
      }),
    ];
    const bump = (): void => {
      void qc.invalidateQueries({ queryKey: ["map", "sites"] });
    };
    for (const s of sockets) {
      s.on("telemetry", bump);
      s.on("alarm", bump);
    }
    return () => {
      for (const s of sockets) {
        s.disconnect();
      }
    };
  }, [accessToken, qc]);

  return (
    <AppShell
      user={user}
      kpiRibbon={
        <span className="text-ink">
          World map · OpenStreetMap · live operational location status
        </span>
      }
    >
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        <PageHeader
          eyebrow="Sites"
          title="Sites & locations"
          subtitle="Markers from Postgres · operational locations use live alarm and comm health"
        />

        <MapSubtreeFilter nodes={nodes} value={rootId} onChange={setRootId} />

        {q.isLoading ? (
          <p className="text-sm text-ink-muted">Loading map data…</p>
        ) : q.isError ? (
          <p className="text-sm text-critical-ink">Could not load map sites.</p>
        ) : !q.data?.length && rootId !== null ? (
          <p className="text-sm text-ink-muted">{`No map pin under ${rootName ?? "this location"}.`}</p>
        ) : !q.data?.length ? (
          <p className="text-sm text-ink-muted">
            No locations — run{" "}
            <code className="surface-pressed-sm px-1 text-xs">pnpm db:seed</code>.
          </p>
        ) : (
          <SectionCard bodyClassName="p-0">
            {/* Keyed by the filter: the map fits its box once per mount (`FitToSites`), so a new
                parent mounts a map that fits the subtree. */}
            <WorldMap
              key={rootId ?? "all"}
              sites={q.data}
              siteLink={estateSiteLink}
              heightClassName="h-[min(70vh,560px)]"
              scrollWheelZoom
            />
          </SectionCard>
        )}
      </div>
    </AppShell>
  );
}
