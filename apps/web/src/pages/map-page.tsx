import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { io, type Socket } from "socket.io-client";

import { fetchMapSites } from "../api/map";
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
        <header className="border-b border-gray-200 pb-4">
          <h1 className="font-condensed text-xl font-bold text-bms-ink sm:text-2xl">
            Eskom stations &amp; SMOC campuses
          </h1>
          <p className="mt-1 text-sm text-bms-muted">
            Prototype Sprint 5 — markers from Postgres (`ESKOM_STATIONS` shape).
            SMOC diamonds use live alarm + comm health; stopping the simulator
            drives campuses toward <span className="font-mono">offline</span>.
          </p>
        </header>

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
          <WorldMap sites={q.data} />
        )}
      </div>
    </AppShell>
  );
}
