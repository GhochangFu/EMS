import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

import { fetchDashboardKpis, fetchLoadTrend } from "../api/dashboard";
import { useAuthStore } from "../stores/auth-store";
import type { LoadTrendPoint, TelemetryReading } from "@bms/shared";
import { openLiveSocket } from "../lib/live-socket";

function socketUrl(): string {
  return (
    import.meta.env.VITE_WS_URL ??
    import.meta.env.VITE_API_URL ??
    "http://localhost:4000"
  );
}

/**
 * KPI polling + telemetry WebSocket for the chart's live tail and stale detection (10 s).
 *
 * `F4.375` (ADR 0133 Amendment 2, plan Q1): the Total load tile shows the server's `totalKw`
 * (4 s poll) — the sum over the locations whose energy is shown, `null` when none in scope does.
 * It used to prefer the sum of the last socket frame's `kw` readings, which counted every `kw`
 * the socket carried (an `off` organization's included) and so differed from the ribbon's rule
 * and from its own "vs yesterday" line. The socket keeps the Live/Stale pill and the chart tail.
 */
export function useExecutiveDashboard() {
  const mountedAt = useRef(Date.now());
  const accessToken = useAuthStore((state) => state.accessToken);
  const [lastTickAt, setLastTickAt] = useState<number | null>(null);
  const [liveTrendAdds, setLiveTrendAdds] = useState<LoadTrendPoint[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const kpiQ = useQuery({
    queryKey: ["dashboard", "kpis"],
    queryFn: fetchDashboardKpis,
    refetchInterval: 4000,
  });

  const trendQ = useQuery({
    queryKey: ["dashboard", "load-trend", "60m"],
    queryFn: () => fetchLoadTrend("60m"),
  });

  useEffect(() => {
    const socket: Socket = openLiveSocket(`${socketUrl()}/ws/telemetry`, {
      transports: ["websocket"],
      auth: { token: accessToken },
    });
    socket.on("telemetry", (payload: { readings?: TelemetryReading[] }) => {
      const readings = payload.readings ?? [];
      setLastTickAt(Date.now());
      const kws = readings.filter((r) => r.pointKey === "kw");
      if (kws.length > 0) {
        const sum = kws.reduce((acc, r) => acc + r.value, 0);
        const t = kws[0]?.time ?? new Date().toISOString();
        setLiveTrendAdds((prev) => {
          const next = [...prev, { t, totalKw: sum }];
          return next.slice(-240);
        });
      }
    });
    return () => {
      socket.disconnect();
    };
  }, [accessToken]);

  const stale =
    (lastTickAt === null &&
      now - mountedAt.current > 10_000 &&
      !kpiQ.isLoading) ||
    (lastTickAt !== null && now - lastTickAt > 10_000);

  const displayTotalKw = kpiQ.data?.totalKw ?? null;

  const chartPoints = useMemo(() => {
    const map = new Map<number, number>();
    for (const p of trendQ.data?.points ?? []) {
      map.set(new Date(p.t).getTime(), p.totalKw);
    }
    for (const p of liveTrendAdds) {
      map.set(new Date(p.t).getTime(), p.totalKw);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ms, totalKw]) => ({
        t: new Date(ms).toISOString(),
        totalKw,
      }));
  }, [trendQ.data, liveTrendAdds]);

  return {
    kpiQuery: kpiQ,
    trendQuery: trendQ,
    stale,
    displayTotalKw,
    chartPoints,
  };
}
