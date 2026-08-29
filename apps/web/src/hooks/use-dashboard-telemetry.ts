import { useQueries } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";

import { encodePointRef, type DashboardDto, type TelemetryReading } from "@bms/shared";

import { fetchTelemetryRecent } from "../api/telemetry";
import { pointRefsFor, type HistoryByRef, type LatestByRef, type LatestReading } from "../lib/dashboard-widget-data";
import { STALE_TICK_MS } from "../lib/schematic-telemetry";
import { socketBaseUrl } from "../lib/socket-url";
import { useAuthStore } from "../stores/auth-store";

/**
 * `F3.1d` Unit 6 — the viewer's one telemetry connection.
 *
 * **One socket for the whole page, never one per point or per widget.**
 * Every reading for every tracked ref arrives over the single `/ws/telemetry`
 * connection this hook owns — the same shape `SchematicTelemetryProvider`
 * already established for the control-room schematics
 * (`components/live-svg/schematic-telemetry-context.tsx`), applied here to a
 * dashboard's bound points instead of a schematic's assets.
 *
 * All mapping onto what a widget draws is `dashboard-widget-data.ts`'s job —
 * this hook only resolves `pointRefsFor(dashboard)` into the two maps
 * `widgetDataFor` reads, via a REST seed (one `fetchTelemetryRecent` per
 * distinct ref, deduplicated by `useQueries`/TanStack Query's own cache) and
 * the live socket.
 *
 * **A fixed history window, not per-widget `config.windowMinutes`.**
 * `TelemetryController.recent` caps its own `window` query at 168 hours
 * (`telemetry.service.ts`'s `parseWindow`), well under `chartConfigSchema`'s
 * own 525,600-minute bound — so no single fixed choice satisfies every
 * configured window anyway, and two widgets can share one ref with two
 * different windows. `HISTORY_WINDOW` seeds the chart; the live socket
 * extends it forward from there for as long as the page stays open.
 */
const HISTORY_WINDOW = "24h";

/** Bounds how much a single point ref's in-memory live overlay can grow across
 * a long-lived page — the same cap `useTelemetryLive` applies per point. */
const MAX_LIVE_SAMPLES = 5000;

export type DashboardTelemetry = {
  latestByRef: LatestByRef;
  historyByRef: HistoryByRef;
  isLoading: boolean;
};

export function useDashboardTelemetry(dashboard: DashboardDto | undefined): DashboardTelemetry {
  const refs = dashboard ? pointRefsFor(dashboard) : [];
  const refsKey = refs.join("|");
  const accessToken = useAuthStore((state) => state.accessToken);

  const seedQueries = useQueries({
    queries: refs.map((ref) => ({
      queryKey: ["telemetry", "recent", ref, HISTORY_WINDOW],
      queryFn: () => fetchTelemetryRecent(ref, HISTORY_WINDOW),
    })),
  });

  // Readings the socket has delivered since this ref set was last tracked,
  // oldest first per ref — reset whenever the tracked refs change so a
  // dashboard switch cannot carry another dashboard's live samples forward.
  const [liveByRef, setLiveByRef] = useState<Map<string, TelemetryReading[]>>(new Map());

  useEffect(() => {
    setLiveByRef(new Map());
  }, [refsKey]);

  // Review finding (HIGH) — forces a re-render every `STALE_TICK_MS` so the caller's staleness
  // gate is re-evaluated even when the socket stays silent, the same idiom
  // `schematic-telemetry-context.tsx`'s own `staleTick` uses for the seven control-room pages.
  // Without this, the only thing that could make a widget notice it had gone stale was an
  // incoming socket message — exactly the signal an outage removes. The counter itself carries
  // no information; it exists only to change this hook's return-triggering state on a timer.
  const [, setStaleTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      setStaleTick((n) => n + 1);
    }, STALE_TICK_MS);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (refs.length === 0) {
      return;
    }
    const trackedRefs = new Set(refs);
    const socket: Socket = io(`${socketBaseUrl()}/ws/telemetry`, {
      transports: ["websocket"],
      auth: { token: accessToken },
    });
    socket.on("telemetry", (payload: { readings?: TelemetryReading[] }) => {
      const mine = (payload.readings ?? []).filter((reading) =>
        trackedRefs.has(encodePointRef(reading.assetId, reading.pointKey)),
      );
      if (mine.length === 0) {
        return;
      }
      setLiveByRef((prev) => {
        const next = new Map(prev);
        for (const reading of mine) {
          const ref = encodePointRef(reading.assetId, reading.pointKey);
          const existing = next.get(ref) ?? [];
          next.set(ref, [...existing, reading].slice(-MAX_LIVE_SAMPLES));
        }
        return next;
      });
    });
    return () => {
      socket.disconnect();
    };
    // `refsKey` stands in for `refs` — a fresh array identity every render
    // must not reopen the socket, only a genuine change to which refs it
    // tracks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, refsKey]);

  const latestByRef = new Map<string, LatestReading | null>();
  const historyByRef = new Map<string, readonly { readonly t: string; readonly v: number | null }[]>();

  refs.forEach((ref, index) => {
    const seeded = seedQueries[index]?.data ?? [];
    const live = liveByRef.get(ref) ?? [];
    // `fetchTelemetryRecent` returns newest-first; reversed here so the
    // history reads oldest-first, then the live overlay — arriving in
    // receive order — extends it forward.
    const ascending = [...seeded].reverse().concat(live);
    historyByRef.set(
      ref,
      ascending.map((reading) => ({ t: reading.time, v: reading.value })),
    );
    const latestLive = live[live.length - 1];
    const latestReading = latestLive ?? seeded[0];
    // Review finding (HIGH) — carries `time` beside `value`, so `widgetDataFor` can age this
    // reading through `isStale` rather than treating a dead sensor's frozen last value as live.
    latestByRef.set(ref, latestReading ? { value: latestReading.value, time: latestReading.time } : null);
  });

  return {
    latestByRef,
    historyByRef,
    isLoading: seedQueries.some((query) => query.isLoading),
  };
}
