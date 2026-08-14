import {
  ELECTRICAL_POINT_KEYS,
  encodePointRef,
  type TelemetryReading,
} from "@bms/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { io, type Socket } from "socket.io-client";

import { fetchTelemetryRecent } from "../../api/telemetry";
import { fetchAssets } from "../../api/assets";
import {
  applyReading,
  deriveStatus,
  emptySlice,
  STALE_TICK_MS,
  sumFresh,
  type SchematicTelemetrySlice,
} from "../../lib/schematic-telemetry";
import { socketBaseUrl } from "../../lib/socket-url";
import { useAuthStore } from "../../stores/auth-store";
import type { LiveSvgStatus } from "./types";

/**
 * Re-exported so the seven control-room pages that import this type keep their
 * existing import path — `F4.37` moved the definition to
 * `lib/schematic-telemetry.ts` to make it testable, not to churn callers.
 */
export type { SchematicTelemetrySlice };

type Ctx = {
  idByCode: Map<string, string>;
  assetMetaById: Map<
    string,
    { code: string; name: string; siteName: string; domain: string }
  >;
  byAssetId: Record<string, SchematicTelemetrySlice>;
  /**
   * Sum of `cooling_kw` if any present, else sum of `kw` — over the assets
   * **still reporting** since `F4.38` (ADR 0027 decision 4). `null` means
   * nothing contributed, which is not the same answer as `0`.
   */
  totalKw: number | null;
  /**
   * Assets left out of `totalKw` because they are stale.
   *
   * Render it beside the total. A number that silently shrank when a feed died
   * is the failure this item exists to close, so the exclusion must be visible
   * wherever the total is.
   */
  staleAssets: number;
  /**
   * Increments every `STALE_TICK_MS` (`F4.37`).
   *
   * It carries no information — it is here to change this context value's
   * identity on a timer, so consumers re-render and `deriveStatus` re-reads the
   * clock. Without it, staleness is only recomputed when a socket payload
   * arrives for some asset on this schematic, which is precisely the event that
   * stops during the outage the offline state exists to show. **Removing it
   * silently freezes every schematic on its last status.**
   */
  staleTick: number;
};

const SchematicTelemetryContext = createContext<Ctx | null>(null);

type ProviderProps = {
  /** Asset codes to follow (must exist in `GET /api/v1/assets`). */
  assetCodes: readonly string[];
  /** Point keys to hydrate and merge (defaults to electrical SLD set). */
  pointKeys?: readonly string[];
  children: React.ReactNode;
};

/**
 * Binds one Socket.IO `/ws/telemetry` client and merges readings for all
 * listed asset codes. Pass `pointKeys: HVAC_POINT_KEYS` for CRAC schematics.
 */
export function SchematicTelemetryProvider({
  assetCodes,
  pointKeys = [...ELECTRICAL_POINT_KEYS],
  children,
}: ProviderProps) {
  const qc = useQueryClient();
  const assetsQ = useQuery({
    queryKey: ["assets"],
    queryFn: fetchAssets,
  });

  const keysMemo = useMemo(() => [...pointKeys], [pointKeys.join("|")]);

  const { idByCode, assetMetaById, trackedIds } = useMemo(() => {
    const idByCode = new Map<string, string>();
    const assetMetaById = new Map<
      string,
      { code: string; name: string; siteName: string; domain: string }
    >();
    const trackedIds: string[] = [];
    const seen = new Set<string>();
    for (const row of assetsQ.data ?? []) {
      idByCode.set(row.code, row.id);
      assetMetaById.set(row.id, {
        code: row.code,
        name: row.name,
        siteName: row.siteName,
        domain: row.domain,
      });
    }
    for (const code of assetCodes) {
      const id = idByCode.get(code);
      if (id && !seen.has(id)) {
        seen.add(id);
        trackedIds.push(id);
      }
    }
    return { idByCode, assetMetaById, trackedIds };
  }, [assetsQ.data, assetCodes]);

  const [byAssetId, setByAssetId] = useState<Record<string, SchematicTelemetrySlice>>(
    {},
  );
  const accessToken = useAuthStore((state) => state.accessToken);

  /**
   * Forces staleness to be re-evaluated on a timer (`F4.37`) — see `Ctx.staleTick`.
   * Mounted unconditionally: a schematic tracking no assets still renders tiles
   * that must go offline.
   */
  const [staleTick, setStaleTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      setStaleTick((n) => n + 1);
    }, STALE_TICK_MS);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  /** Hydrate latest values from REST when asset list is ready. */
  useEffect(() => {
    if (trackedIds.length === 0) {
      return;
    }

    let cancelled = false;

    (async () => {
      const next: Record<string, SchematicTelemetrySlice> = {};

      for (const id of trackedIds) {
        let slice = emptySlice();
        for (const pointKey of keysMemo) {
          const ref = encodePointRef(id, pointKey);
          try {
            const rows = await fetchTelemetryRecent(ref, "15m");
            const latest = rows[0];
            if (latest) {
              slice = applyReading(slice, latest, Date.now());
            }
          } catch {
            /* leave partial */
          }
        }
        next[id] = slice;
      }

      if (!cancelled) {
        setByAssetId((prev) => ({ ...prev, ...next }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [trackedIds.join("|"), keysMemo.join("|")]);

  const onSocketPayload = useCallback(
    (payload: { readings?: TelemetryReading[] }) => {
      const readings = payload.readings ?? [];
      if (readings.length === 0) {
        return;
      }
      // One clock reading for the batch: the clamp only needs to bound a
      // future timestamp, and a per-reading `Date.now()` would let two readings
      // in the same payload disagree about when "now" was.
      const nowMs = Date.now();
      setByAssetId((prev) => {
        const next = { ...prev };
        for (const r of readings) {
          if (!trackedIds.includes(r.assetId)) {
            continue;
          }
          next[r.assetId] = applyReading(
            next[r.assetId] ?? emptySlice(),
            r,
            nowMs,
          );
        }
        return next;
      });
    },
    [trackedIds],
  );

  useEffect(() => {
    if (trackedIds.length === 0) {
      return;
    }
    const socket: Socket = io(`${socketBaseUrl()}/ws/telemetry`, {
      transports: ["websocket"],
      auth: { token: accessToken },
    });
    socket.on("telemetry", onSocketPayload);
    return () => {
      socket.disconnect();
    };
  }, [accessToken, trackedIds.join("|"), onSocketPayload]);

  /**
   * Bus total over the assets still reporting (ADR 0027 decision 4).
   *
   * Before `F4.38` this summed every slice's last known value, so a dead asset
   * kept contributing load it was no longer producing — the header asserted
   * megawatts that nothing was measuring. `sumFresh` drops stale slices and
   * counts what it dropped, so the fall in the number is explained on screen
   * rather than mysterious.
   *
   * `staleTick` is in the dependency list on purpose: this reads the clock, so
   * it has to be recomputed on the timer as well as on new telemetry. Without
   * it the total would only be re-summed when a reading arrives, which is the
   * signal that stops in the outage this is meant to show.
   */
  const { totalKw, staleAssets } = useMemo(() => {
    const slices = trackedIds
      .map((id) => byAssetId[id])
      .filter((s): s is SchematicTelemetrySlice => s != null);
    const nowMs = Date.now();
    // Cooling wins over real power where any asset reports it, as before —
    // a CRAC schematic's "total" is its cooling duty, not its input draw.
    // **The basis is chosen before summing, not after.** Picking it from
    // `cool.total !== null` meant that once every cooling asset went stale the
    // total silently fell back to summing `kw` over the live electrical assets
    // — the header kept its "MW" label while changing what it measured, and the
    // stale note explained a drop that was really a substitution. Raised by the
    // F4.38 security review.
    const coolingBasis = slices.some((s) => s.coolingKw != null);
    const sum = coolingBasis
      ? sumFresh(slices, (s) => s.coolingKw, nowMs)
      : sumFresh(slices, (s) => s.kw, nowMs);
    return { totalKw: sum.total, staleAssets: sum.staleExcluded };
  }, [byAssetId, trackedIds, staleTick]);

  const value = useMemo(
    () => ({
      idByCode,
      assetMetaById,
      byAssetId,
      totalKw,
      staleAssets,
      staleTick,
    }),
    [idByCode, assetMetaById, byAssetId, totalKw, staleAssets, staleTick],
  );

  useEffect(() => {
    for (const id of trackedIds) {
      for (const pk of keysMemo) {
        const ref = encodePointRef(id, pk);
        void qc.prefetchQuery({
          queryKey: ["telemetry", "recent", ref],
          queryFn: () => fetchTelemetryRecent(ref, "15m"),
        });
      }
    }
  }, [qc, trackedIds, keysMemo.join("|")]);

  return (
    <SchematicTelemetryContext.Provider value={value}>
      {children}
    </SchematicTelemetryContext.Provider>
  );
}

export function useSchematicTelemetryContext(): Ctx | null {
  return useContext(SchematicTelemetryContext);
}

/** Live slice + derived status for one asset UUID. */
export function useSchematicTelemetry(assetId: string | undefined): {
  slice: SchematicTelemetrySlice;
  status: LiveSvgStatus;
  stale: boolean;
} {
  const ctx = useContext(SchematicTelemetryContext);
  const slice =
    assetId && ctx?.byAssetId[assetId]
      ? ctx.byAssetId[assetId]!
      : emptySlice();
  // Read at render rather than taken from `ctx.staleTick`, so the comparison
  // uses the true current time; the tick's only job is to make this render
  // happen when nothing else would.
  const { status, stale } = deriveStatus(slice, Date.now());
  return { slice, status, stale };
}

/** Resolve seeded asset code to telemetry (after provider + assets load). */
export function useSchematicTelemetryByCode(code: string | undefined): {
  assetId: string | undefined;
  slice: SchematicTelemetrySlice;
  status: LiveSvgStatus;
  stale: boolean;
} {
  const ctx = useContext(SchematicTelemetryContext);
  const assetId = code ? ctx?.idByCode.get(code) : undefined;
  const { slice, status, stale } = useSchematicTelemetry(assetId);
  return { assetId, slice, status, stale };
}

export function useSchematicAssetMeta(assetId: string | undefined) {
  const ctx = useContext(SchematicTelemetryContext);
  if (!assetId || !ctx) {
    return null;
  }
  return ctx.assetMetaById.get(assetId) ?? null;
}
