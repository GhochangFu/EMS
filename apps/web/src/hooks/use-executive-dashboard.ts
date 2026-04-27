import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

import { fetchDashboardKpis, fetchLoadTrend } from "../api/dashboard";
import type { LoadTrendPoint, TelemetryReading } from "@bms/shared";

function socketUrl(): string {
  return (
    import.meta.env.VITE_WS_URL ??
    import.meta.env.VITE_API_URL ??
    "http://localhost:4000"
  );
}

/**
 * KPI polling + telemetry WebSocket for live totals, chart tail, and stale detection (10 s).
 */
export function useExecutiveDashboard() {
  const mountedAt = useRef(Date.now());
  const [lastTickAt, setLastTickAt] = useState<number | null>(null);
  const [liveTotalKw, setLiveTotalKw] = useState<number | null>(null);
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
    const socket: Socket = io(`${socketUrl()}/ws/telemetry`, {
      transports: ["websocket"],
    });
    socket.on("telemetry", (payload: { readings?: TelemetryReading[] }) => {
      const readings = payload.readings ?? [];
      setLastTickAt(Date.now());
      const kws = readings.filter((r) => r.pointKey === "kw");
      if (kws.length > 0) {
        const sum = kws.reduce((acc, r) => acc + r.value, 0);
        setLiveTotalKw(sum);
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
  }, []);

  const stale =
    (lastTickAt === null &&
      now - mountedAt.current > 10_000 &&
      !kpiQ.isLoading) ||
    (lastTickAt !== null && now - lastTickAt > 10_000);

  const displayTotalKw = stale
    ? (kpiQ.data?.totalKw ?? null)
    : (liveTotalKw ?? kpiQ.data?.totalKw ?? null);

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
