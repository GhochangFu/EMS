import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

import { fetchTelemetryRecent } from "../api/telemetry";
import { encodePointRef, type TelemetryReading } from "@bms/shared";

function socketUrl(): string {
  return (
    import.meta.env.VITE_WS_URL ??
    import.meta.env.VITE_API_URL ??
    "http://localhost:4000"
  );
}

/**
 * TanStack Query seed for recent history + Socket.IO `/ws/telemetry` for live rows.
 * In development, logs matching samples to the browser console (Sprint 2 smoke).
 */
export function useTelemetryLive(pointRefEncoded: string | null) {
  const qc = useQueryClient();
  const [live, setLive] = useState<TelemetryReading | null>(null);
  const lastLogged = useRef<number | null>(null);

  const query = useQuery({
    queryKey: ["telemetry", "recent", pointRefEncoded],
    enabled: !!pointRefEncoded,
    queryFn: () => fetchTelemetryRecent(pointRefEncoded!, "15m"),
  });

  useEffect(() => {
    if (!pointRefEncoded) {
      return;
    }

    const socket: Socket = io(`${socketUrl()}/ws/telemetry`, {
      transports: ["websocket"],
    });

    socket.on("telemetry", (payload: { readings?: TelemetryReading[] }) => {
      const readings = payload.readings ?? [];
      const mine = readings.find(
        (r) => encodePointRef(r.assetId, r.pointKey) === pointRefEncoded,
      );
      if (mine) {
        setLive(mine);
        qc.setQueryData<TelemetryReading[]>(
          ["telemetry", "recent", pointRefEncoded],
          (prev) => {
            const next = prev ? [mine, ...prev] : [mine];
            return next.slice(0, 5000);
          },
        );
        if (import.meta.env.DEV) {
          const t = new Date(mine.time).getTime();
          if (lastLogged.current !== t) {
            lastLogged.current = t;
            // Sprint 2 exit: visible in devtools console
            console.debug("[useTelemetryLive]", pointRefEncoded, mine.value, mine.unit);
          }
        }
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [pointRefEncoded, qc]);

  return {
    ...query,
    liveSample: live,
    /** Convenience for kW display when point is `kw`. */
    liveValue: live?.value ?? query.data?.[0]?.value ?? null,
  };
}
