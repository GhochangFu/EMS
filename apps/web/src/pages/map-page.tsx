import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { io, type Socket } from "socket.io-client";

import { fetchMapSites } from "../api/map";
import { PageHeader } from "../components/page-header";
import { SectionCard } from "../components/section-card";
import { WorldMap } from "../components/world-map";
import { AppShell } from "../layouts/app-shell";
import { socketBaseUrl } from "../lib/socket-url";
import type { AuthUser } from "../stores/auth-store";

type MapPageProps = {
  user: AuthUser;
};

export function MapPage({ user }: MapPageProps) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["map", "sites"],
    queryFn: fetchMapSites,
    refetchInterval: 8000,
  });

  useEffect(() => {
    const base = socketBaseUrl();
    const sockets: Socket[] = [
      io(`${base}/ws/telemetry`, { transports: ["websocket"] }),
      io(`${base}/ws/alarms`, { transports: ["websocket"] }),
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
  }, [qc]);

  return (
    <AppShell
      user={user}
      kpiRibbon={
        <span className="text-bms-ink">
          World map · CARTO dark basemap · live SMOC status (telemetry + alarms)
        </span>
      }
    >
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        <PageHeader
          eyebrow="Sites"
          title="Eskom stations & SMOC campuses"
          subtitle="Markers from Postgres · SMOC diamonds use live alarm and comm health"
        />

        {q.isLoading ? (
          <p className="text-sm text-bms-muted">Loading map data…</p>
        ) : q.isError ? (
          <p className="text-sm text-red-600">Could not load map sites.</p>
        ) : !q.data?.length ? (
          <p className="text-sm text-bms-muted">
            No locations — run{" "}
            <code className="rounded bg-gray-100 px-1 text-xs">pnpm db:seed</code>.
          </p>
        ) : (
          <SectionCard bodyClassName="p-0">
            <WorldMap sites={q.data} />
          </SectionCard>
        )}
      </div>
    </AppShell>
  );
}
