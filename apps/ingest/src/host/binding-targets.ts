import { QUALITY_POLICIES, type QualityPolicy } from "@bms/shared/ingest";

import type { BindingRow } from "./bindings.js";
import type { PointIndex, PointTarget } from "./normaliser.js";

/**
 * Binding rows → point targets, shared by the cloud endpoints and the
 * edge-served map (`E7.2`, ADR 0123 decision 6). Out of `bindings.ts` because
 * §4.5 caps a file at 1000 lines; one builder for both paths is what makes
 * "the edge pointIndex equals what the endpoint would have held"
 * (`bindings-edge.spec.ts` E2) true by construction.
 */

/** One gateway's RTUs, for the cloud receiver (PR 3): who it may write, and where to. */
export type EdgeServedGateway = {
  /** `rtus.rtu_code` of every RTU bound to the gateway — the wire's `deviceKey`. */
  readonly deviceKeys: ReadonlySet<string>;
  /**
   * `deviceKey → rtus.id` (`F3.16`, ADR 0127 decision 18): the receiver records
   * an edge-served RTU's last-seen and drops under its id. Whether an RTU is
   * edge-served is not stored by the host; the API reads it from
   * `rtus.edge_gateway_id`.
   */
  readonly rtuIdByDeviceKey: ReadonlyMap<string, string>;
  /** `deviceKey → sourceKey → targets`, built exactly as an endpoint's. */
  readonly pointIndex: PointIndex;
};

/** `edge_gateways.id → EdgeServedGateway`. */
export type EdgeServed = ReadonlyMap<string, EdgeServedGateway>;

type MutableIndex = Map<string, Map<string, PointTarget[]>>;

/** The mutable accumulator `planEndpoints` fills and returns as `EdgeServed`. */
export type EdgeServedAccumulator = Map<
  string,
  { deviceKeys: Set<string>; rtuIdByDeviceKey: Map<string, string>; pointIndex: MutableIndex }
>;

/**
 * Narrows a stored `quality_policy` to the vocabulary this build knows.
 *
 * The column is a `varchar(16)` with a CHECK, so a row can carry a value a newer
 * API wrote and this host has never heard of. An unknown string resolves to
 * `null`, which is `discard_bad` — the safe reading, and the one that keeps the
 * host's branch set closed. Declared here rather than in `packages/shared`
 * because the host is the only thing that acts on the value.
 */
function isQualityPolicy(value: string | null): value is QualityPolicy {
  return value !== null && (QUALITY_POLICIES as readonly string[]).includes(value);
}

/** One binding row's write target. */
export function toPointTarget(row: BindingRow): PointTarget {
  return {
    assetId: row.asset_id,
    pointKey: row.point_key,
    unit: row.unit,
    scaleMultiplier: row.scale_multiplier,
    scaleOffset: row.scale_offset,
    engMin: row.eng_min,
    engMax: row.eng_max,
    qualityPolicy: isQualityPolicy(row.quality_policy) ? row.quality_policy : null,
  };
}

/**
 * Adds one device's rows to `index` under `deviceKey`. Targets are a list per
 * source key: two assets may share one `source_data_key` (see `PointIndex`).
 */
export function indexPointRows(index: MutableIndex, deviceKey: string, rows: readonly BindingRow[]): void {
  let bySourceKey = index.get(deviceKey);
  if (bySourceKey === undefined) {
    bySourceKey = new Map();
    index.set(deviceKey, bySourceKey);
  }
  for (const row of rows) {
    const targets = bySourceKey.get(row.source_data_key);
    const target = toPointTarget(row);
    if (targets === undefined) {
      bySourceKey.set(row.source_data_key, [target]);
    } else {
      targets.push(target);
    }
  }
}

/** Records one edge-served RTU under its gateway. */
export function addEdgeServed(
  acc: EdgeServedAccumulator,
  gatewayId: string,
  rtuId: string,
  deviceKey: string,
  rows: readonly BindingRow[],
): void {
  let gateway = acc.get(gatewayId);
  if (gateway === undefined) {
    gateway = { deviceKeys: new Set(), rtuIdByDeviceKey: new Map(), pointIndex: new Map() };
    acc.set(gatewayId, gateway);
  }
  gateway.deviceKeys.add(deviceKey);
  gateway.rtuIdByDeviceKey.set(deviceKey, rtuId);
  indexPointRows(gateway.pointIndex, deviceKey, rows);
}

/** Counts only — for the host's log lines, never the device keys (ADR 0123). */
export function edgeServedCounts(edgeServed: EdgeServed): { edgeGateways: number; edgeServedRtus: number } {
  let edgeServedRtus = 0;
  for (const gateway of edgeServed.values()) {
    edgeServedRtus += gateway.deviceKeys.size;
  }
  return { edgeGateways: edgeServed.size, edgeServedRtus };
}
