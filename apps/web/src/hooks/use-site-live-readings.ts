import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

import {
  encodePointRef,
  type GeneratedSiteAssetDto,
  type GeneratedSiteViewDto,
  type TelemetryReading,
} from "@bms/shared";

import {
  clampSample,
  clampSeeded,
  NO_SEEDED_CLAMPS,
  overlayReading,
  type ClampedLatest,
  type SeededClamps,
} from "../lib/generated-site-view";
import { STALE_TICK_MS } from "../lib/schematic-telemetry";
import { socketBaseUrl } from "../lib/socket-url";
import { useAuthStore } from "../stores/auth-store";

/** What `useSiteLiveReadings` hands each asset card. */
export type SiteLiveReadings = {
  /** `Date.now()` at this render — the instant every status is judged at. */
  readonly nowMs: number;
  /** A point's newest sample, seeded or live, with its clamped time. */
  pointLatest(assetId: string, point: { pointKey: string }): ClampedLatest | null;
  /** An asset's newest registered-point sample, clamped; `null` when it has none. */
  assetLastSeenMs(asset: GeneratedSiteAssetDto): number | null;
};

type LiveState = {
  readonly points: ReadonlyMap<string, ClampedLatest>;
  readonly lastSeen: ReadonlyMap<string, number>;
};

const EMPTY: LiveState = { points: new Map(), lastSeen: new Map() };

function trackedRefs(view: GeneratedSiteViewDto | undefined): Set<string> {
  const refs = new Set<string>();
  for (const domain of view?.domains ?? []) {
    for (const asset of domain.assets) {
      for (const point of asset.points) {
        refs.add(encodePointRef(asset.id, point.pointKey));
      }
    }
  }
  return refs;
}

/**
 * `F3.68` U6 — the generated site view's one `/ws/telemetry` connection, the
 * `use-dashboard-telemetry` recipe applied to a site's registered points.
 *
 * - **One socket per `locationId` and token.** The tracked `(asset, point)`
 *   set is read through a ref, so a refetch of the view re-targets the filter
 *   without reopening the connection. The gateway already filters every socket
 *   by `readableAssetIds`, so no scope logic lives here.
 * - **Only registered points count** (D3): a reading for an asset the view does
 *   not hold, or for a key the asset has not registered, changes neither a row
 *   nor the asset's status — the server's `freshness` is judged the same way.
 * - **Seeded from the DTO at read time.** A point shows the newer of its seeded
 *   and its live sample (`overlayReading`); an asset's last-seen instant is the
 *   later of `latestTelemetryAt` and its newest tracked reading.
 * - **Every time is clamped once, when it arrives, and stored clamped**
 *   (`F4.37`): a socket reading at its receipt, the generated read's samples
 *   at the query's `dataUpdatedAt` (`clampSeeded`, which keeps the first clamp
 *   of a sample a refetch re-supplies unchanged). Nothing is clamped at
 *   render, so producer skew can neither mark a fresh asset stale nor keep a
 *   silent one live.
 * - **One `STALE_TICK_MS` interval**, created once with an empty dependency
 *   array, and nothing returns before it. It only forces a re-render; `nowMs`
 *   is `Date.now()` read at render. Keeping `nowMs` in state and advancing it
 *   only on the tick would put a reading that has just arrived *after* `nowMs`,
 *   and `isStale` reads a future sample as stale.
 */
export function useSiteLiveReadings(
  locationId: string,
  view: GeneratedSiteViewDto | undefined,
  dataUpdatedAt: number,
): SiteLiveReadings {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [live, setLive] = useState<LiveState>(EMPTY);
  const tracked = useRef<Set<string>>(new Set());
  tracked.current = trackedRefs(view);

  const previousSeeded = useRef<SeededClamps>(NO_SEEDED_CLAMPS);
  const seeded = useMemo(() => {
    const next = clampSeeded(view, dataUpdatedAt, previousSeeded.current);
    previousSeeded.current = next;
    return next;
  }, [view, dataUpdatedAt]);

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
    setLive(EMPTY);
    const socket: Socket = io(`${socketBaseUrl()}/ws/telemetry`, {
      transports: ["websocket"],
      auth: { token: accessToken },
    });
    socket.on("telemetry", (payload: { readings?: TelemetryReading[] }) => {
      const mine = (payload.readings ?? []).filter((r) =>
        tracked.current.has(encodePointRef(r.assetId, r.pointKey)),
      );
      if (mine.length === 0) {
        return;
      }
      const arrivedAt = Date.now();
      setLive((prev) => {
        const points = new Map(prev.points);
        const lastSeen = new Map(prev.lastSeen);
        for (const r of mine) {
          const sample = clampSample({ value: r.value, time: r.time }, arrivedAt);
          if (sample === null) {
            continue;
          }
          const ref = encodePointRef(r.assetId, r.pointKey);
          points.set(ref, overlayReading(points.get(ref) ?? null, sample) ?? sample);
          lastSeen.set(r.assetId, Math.max(lastSeen.get(r.assetId) ?? sample.atMs, sample.atMs));
        }
        return { points, lastSeen };
      });
    });
    return () => {
      socket.disconnect();
    };
  }, [locationId, accessToken]);

  const nowMs = Date.now();
  return {
    nowMs,
    pointLatest: (assetId, point) => {
      const ref = encodePointRef(assetId, point.pointKey);
      return overlayReading(seeded.points.get(ref) ?? null, live.points.get(ref));
    },
    assetLastSeenMs: (asset) => {
      const fromSeed = seeded.assets.get(asset.id)?.atMs ?? null;
      const fromSocket = live.lastSeen.get(asset.id) ?? null;
      if (fromSeed === null) {
        return fromSocket;
      }
      return fromSocket === null ? fromSeed : Math.max(fromSeed, fromSocket);
    },
  };
}
