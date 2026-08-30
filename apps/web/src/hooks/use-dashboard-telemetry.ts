import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

import {
  encodePointRef,
  type DashboardDto,
  type PointAggregateResponse,
  type TelemetryReading,
} from "@bms/shared";

import { fetchPointAggregate, fetchTelemetryRecent } from "../api/telemetry";
import { refsToRefetch } from "../lib/dashboard-aggregate-refresh";
import { mergeSeededAndLiveReadings } from "../lib/dashboard-telemetry-merge";
import {
  aggregateRequestsFor,
  pointRefsFor,
  type AggregateByKey,
  type HistoryByRef,
  type LatestByRef,
  type LatestReading,
} from "../lib/dashboard-widget-data";
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
  /** `F3.35` — one entry per distinct aggregate read, keyed by `aggregateKeyFor`. */
  aggregateByKey: AggregateByKey;
  isLoading: boolean;
};

/** The TanStack key for one aggregate read. Every field of the request is in it, or two
 * widgets asking the same point for different windows would share one cache entry. */
const aggregateQueryKey = (request: {
  ref: string;
  windowMinutes: number;
  compare: boolean;
  bucketFunction?: string;
}) =>
  [
    "telemetry",
    "aggregate",
    request.ref,
    request.windowMinutes,
    request.compare,
    request.bucketFunction ?? "",
  ] as const;

export function useDashboardTelemetry(dashboard: DashboardDto | undefined): DashboardTelemetry {
  const refs = dashboard ? pointRefsFor(dashboard) : [];
  const refsKey = refs.join("|");
  const accessToken = useAuthStore((state) => state.accessToken);
  const queryClient = useQueryClient();

  const seedQueries = useQueries({
    queries: refs.map((ref) => ({
      queryKey: ["telemetry", "recent", ref, HISTORY_WINDOW],
      queryFn: () => fetchTelemetryRecent(ref, HISTORY_WINDOW),
    })),
  });

  /**
   * `F3.35` Stage A — the second data path (ADR 0048 decision 3).
   *
   * **Empty for every dashboard saved before `F3.35`**, and for every one that
   * uses no aggregation after it: `aggregateRequestsFor` returns nothing unless
   * a widget's config asks. So the raw seed above stays the only read on the
   * page it always was, and this is additive rather than a replacement.
   *
   * Requests are already deduplicated by `aggregateKeyFor` — two widgets asking
   * the same point for the same window and function are one read — and TanStack
   * deduplicates again on the key.
   */
  const aggregateRequests = dashboard ? aggregateRequestsFor(dashboard) : [];
  const aggregateQueries = useQueries({
    queries: aggregateRequests.map((request) => ({
      queryKey: aggregateQueryKey(request),
      queryFn: (): Promise<PointAggregateResponse> =>
        fetchPointAggregate(request.ref, {
          windowMinutes: request.windowMinutes,
          compare: request.compare,
          bucketFunction: request.bucketFunction,
        }),
    })),
  });

  // Readings the socket has delivered since this ref set was last tracked,
  // oldest first per ref — reset whenever the tracked refs change so a
  // dashboard switch cannot carry another dashboard's live samples forward.
  const [liveByRef, setLiveByRef] = useState<Map<string, TelemetryReading[]>>(new Map());

  useEffect(() => {
    setLiveByRef(new Map());
  }, [refsKey]);

  // `F3.35` — when each ref's aggregate was last re-read. A ref, not state:
  // writing it must not re-render, and the socket handler closes over it so the
  // throttle survives the renders `setLiveByRef` causes. Keyed by ref rather
  // than page-wide — see `refsToRefetch`.
  const lastAggregateRefetchRef = useRef<Map<string, number>>(new Map());

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

      // `F3.35` — a bucketed series is re-read, never extended. TimescaleDB
      // serves the newest partial bucket exactly (`materialized_only = false`,
      // ADR 0023), so a refetch is the correct value rather than an
      // approximation of one — and recomputing a bucket's mean here would need
      // `sample_count`, which the `{ t, v }` shape deliberately does not carry.
      //
      // Invalidated PER REF, using the refs that actually reported: `mine` is
      // already filtered to `trackedRefs`, so a busy page does not re-read every
      // widget because one sensor spoke.
      //
      // **The throttle is per ref too, and that matters** (code review). One
      // page-wide clock looked equivalent and was not: a payload arriving second
      // in the same round would fail the floor the first one had just reset, and
      // be discarded with nothing queueing it. Several payloads per round is the
      // normal case — `notify-chunk.ts` splits a batch at 7,000 bytes, and five
      // RTUs publish on their own cadences.
      for (const ref of refsToRefetch(
        mine.map((r) => encodePointRef(r.assetId, r.pointKey)),
        lastAggregateRefetchRef.current,
        Date.now(),
      )) {
        void queryClient.invalidateQueries({ queryKey: ["telemetry", "aggregate", ref] });
      }
    });
    return () => {
      socket.disconnect();
    };
    // `refsKey` stands in for `refs` — a fresh array identity every render
    // must not reopen the socket, only a genuine change to which refs it
    // tracks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, refsKey, queryClient]);

  const latestByRef = new Map<string, LatestReading | null>();
  const historyByRef = new Map<string, readonly { readonly t: string; readonly v: number | null }[]>();

  refs.forEach((ref, index) => {
    const seeded = seedQueries[index]?.data ?? [];
    const live = liveByRef.get(ref) ?? [];
    // Review finding (HIGH) — a plain concat drew every live sample TWICE after a window-focus
    // refetch: `main.tsx` leaves `refetchOnWindowFocus` at the TanStack default with
    // `staleTime: 0`, so returning to the tab re-fetches a window that already contains
    // whatever the overlay collected while backgrounded, and `buildChartOption` neither
    // filters nor deduplicates. `mergeSeededAndLiveReadings` (`dashboard-telemetry-merge.ts`)
    // drops an overlay sample once the fresh seed has re-supplied it.
    const ascending = mergeSeededAndLiveReadings(seeded, live);
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

  const aggregateByKey = new Map<string, PointAggregateResponse | null>();
  aggregateRequests.forEach((request, index) => {
    // `null` for a request that has not resolved yet — `widgetDataFor` reads
    // that as "asked for, not answered", which stays a readable `"ready"`
    // widget with a null primary (ADR 0047 Amendment 1), not an error.
    aggregateByKey.set(request.key, aggregateQueries[index]?.data ?? null);
  });

  return {
    latestByRef,
    historyByRef,
    aggregateByKey,
    // Both lists are recomputed unconditionally every render, so `.some()` over
    // an empty array already answers `false` for a dashboard that aggregates
    // nothing. An earlier version guarded this with a key string and a comment
    // claiming the guard made the list re-derive; it did not, and the guard was
    // a no-op (code review).
    isLoading:
      seedQueries.some((query) => query.isLoading) ||
      aggregateQueries.some((query) => query.isLoading),
  };
}
