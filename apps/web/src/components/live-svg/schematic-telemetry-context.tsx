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
import { socketBaseUrl } from "../../lib/socket-url";
import type { LiveSvgStatus } from "./types";

const FRESH_MS = 25_000;

export type SchematicTelemetrySlice = {
  kw: number | null;
  breaker: number | null;
  voltage: number | null;
  current: number | null;
  pf: number | null;
  supplyAirTempC: number | null;
  returnAirTempC: number | null;
  fanRpm: number | null;
  fanSpeedPct: number | null;
  chwFlowLps: number | null;
  chwSupplyTempC: number | null;
  chwReturnTempC: number | null;
  /** 1 = OK, 0 = trip (HVAC). */
  compressorOk: number | null;
  coolingKw: number | null;
  lastSeenMs: number | null;
};

type Ctx = {
  idByCode: Map<string, string>;
  assetMetaById: Map<
    string,
    { code: string; name: string; siteName: string; domain: string }
  >;
  byAssetId: Record<string, SchematicTelemetrySlice>;
  /** Sum of `cooling_kw` if any present, else sum of `kw`. */
  totalKw: number | null;
};

const SchematicTelemetryContext = createContext<Ctx | null>(null);

function emptySlice(): SchematicTelemetrySlice {
  return {
    kw: null,
    breaker: null,
    voltage: null,
    current: null,
    pf: null,
    supplyAirTempC: null,
    returnAirTempC: null,
    fanRpm: null,
    fanSpeedPct: null,
    chwFlowLps: null,
    chwSupplyTempC: null,
    chwReturnTempC: null,
    compressorOk: null,
    coolingKw: null,
    lastSeenMs: null,
  };
}

function applyReading(
  prev: SchematicTelemetrySlice,
  r: TelemetryReading,
): SchematicTelemetrySlice {
  const t = new Date(r.time).getTime();
  const next = { ...prev, lastSeenMs: t };
  switch (r.pointKey) {
    case "kw":
      return { ...next, kw: r.value };
    case "breaker_main":
      return { ...next, breaker: r.value };
    case "voltage_l1_v":
      return { ...next, voltage: r.value };
    case "current_a":
      return { ...next, current: r.value };
    case "pf":
      return { ...next, pf: r.value };
    case "supply_air_temp_c":
      return { ...next, supplyAirTempC: r.value };
    case "return_air_temp_c":
      return { ...next, returnAirTempC: r.value };
    case "fan_rpm":
      return { ...next, fanRpm: r.value };
    case "fan_speed_pct":
      return { ...next, fanSpeedPct: r.value };
    case "chw_flow_lps":
      return { ...next, chwFlowLps: r.value };
    case "chw_supply_temp_c":
      return { ...next, chwSupplyTempC: r.value };
    case "chw_return_temp_c":
      return { ...next, chwReturnTempC: r.value };
    case "compressor_ok":
      return { ...next, compressorOk: r.value };
    case "cooling_kw":
      return { ...next, coolingKw: r.value };
    default:
      return next;
  }
}

function deriveStatus(slice: SchematicTelemetrySlice): {
  status: LiveSvgStatus;
  stale: boolean;
} {
  const stale =
    slice.lastSeenMs == null || Date.now() - slice.lastSeenMs > FRESH_MS;
  if (stale) {
    return { status: "offline", stale: true };
  }
  if (slice.breaker === 0) {
    return { status: "fault", stale: false };
  }
  if (slice.compressorOk === 0) {
    return { status: "fault", stale: false };
  }
  return { status: "running", stale: false };
}

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
              slice = applyReading(slice, latest);
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
      setByAssetId((prev) => {
        const next = { ...prev };
        for (const r of readings) {
          if (!trackedIds.includes(r.assetId)) {
            continue;
          }
          next[r.assetId] = applyReading(next[r.assetId] ?? emptySlice(), r);
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
    });
    socket.on("telemetry", onSocketPayload);
    return () => {
      socket.disconnect();
    };
  }, [trackedIds.join("|"), onSocketPayload]);

  const totalKw = useMemo(() => {
    let sumCool = 0;
    let anyCool = false;
    let sumKw = 0;
    let anyKw = false;
    for (const id of trackedIds) {
      const s = byAssetId[id];
      if (s?.coolingKw != null && !Number.isNaN(s.coolingKw)) {
        sumCool += s.coolingKw;
        anyCool = true;
      }
      if (s?.kw != null && !Number.isNaN(s.kw)) {
        sumKw += s.kw;
        anyKw = true;
      }
    }
    if (anyCool) {
      return sumCool;
    }
    return anyKw ? sumKw : null;
  }, [byAssetId, trackedIds]);

  const value = useMemo(
    () => ({
      idByCode,
      assetMetaById,
      byAssetId,
      totalKw,
    }),
    [idByCode, assetMetaById, byAssetId, totalKw],
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
  const { status, stale } = deriveStatus(slice);
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
