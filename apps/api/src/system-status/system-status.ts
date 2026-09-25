import type {
  QueueHealth,
  StorageHealth,
  SystemComponent,
  SystemComponentState,
  SystemStatusResponse,
} from "@bms/shared";

/**
 * `F3.30` (ADR 0075 decisions 1, 3) — the pure rules of `GET
 * /api/v1/system/status`: one state per component, the verdict over them,
 * and the data-quality percent. No I/O; `SystemStatusService` binds the two
 * health reads and the scoped count query, then calls these.
 *
 * `not_configured` and `not_monitored` are chosen or empty states, never a
 * degradation — the `/health` rule for an unconfigured queue (ADR 0002).
 */

/**
 * The `queue` component from `GET /health`'s queue section. `configured` is
 * checked first: an unconfigured queue also reads `connected: false` and
 * `heartbeatStale: true`, and must still read `not_configured`.
 */
export function queueComponentState(queue: QueueHealth): SystemComponentState {
  if (!queue.configured) {
    return "not_configured";
  }
  if (!queue.connected || queue.heartbeatStale) {
    return "degraded";
  }
  return "ok";
}

/** The `storage` component. Unconfigured storage also reads `reachable: false`, so `configured` goes first. */
export function storageComponentState(storage: StorageHealth): SystemComponentState {
  if (!storage.configured) {
    return "not_configured";
  }
  return storage.reachable ? "ok" : "degraded";
}

/**
 * The `field_data` component, inferred from the caller's own assets on
 * `source_type = 'mqtt'` RTUs (ADR 0075 decision 3). The accepted limit: when
 * every MQTT device is silent this reads `degraded` although the ingest host
 * runs — the API has no ingest heartbeat until `F3.16`.
 */
export function fieldDataState(counts: {
  readonly mqttAssets: number;
  readonly mqttFresh: number;
}): SystemComponentState {
  if (counts.mqttAssets === 0) {
    return "not_monitored";
  }
  return counts.mqttFresh > 0 ? "ok" : "degraded";
}

/** `operational` when no component is `degraded`, otherwise `degraded`. */
export function verdict(components: readonly SystemComponent[]): SystemStatusResponse["status"] {
  return components.some((c) => c.state === "degraded") ? "degraded" : "operational";
}

/**
 * Fresh share of streaming assets, one decimal (plan decision 5). `null` when
 * nothing streams — never `0` or `100` for an empty denominator.
 */
export function dataQualityPercent(fresh: number, streaming: number): number | null {
  if (streaming === 0) {
    return null;
  }
  return Math.round((fresh / streaming) * 1000) / 10;
}
