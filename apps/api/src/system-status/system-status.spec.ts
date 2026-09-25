import type { QueueHealth, StorageHealth, SystemComponent } from "@bms/shared";

import {
  dataQualityPercent,
  fieldDataState,
  queueComponentState,
  storageComponentState,
  verdict,
} from "./system-status";

/**
 * `F3.30` (ADR 0075 decisions 1, 3) — the pure half of the system status
 * read: one state per component, the verdict, and the data-quality percent.
 * Assertions live here; `system-status.test.ts` is the Vitest wrapper
 * (§4.6/ADR 0014). One claim per exported function.
 *
 * The fixtures are the shapes the real services return, so a check made in
 * the wrong order cannot stay green: an unconfigured queue also reads
 * `connected: false` and `heartbeatStale: true`, and unconfigured storage
 * also reads `reachable: false`.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const HEALTHY_QUEUE: QueueHealth = {
  configured: true,
  connected: true,
  queues: [],
  lastHeartbeatAt: "2026-09-25T12:00:00.000Z",
  heartbeatStale: false,
  lastRuleSweep: null,
};

const HEALTHY_STORAGE: StorageHealth = { configured: true, reachable: true, bucket: "b" };

function component(key: SystemComponent["key"], state: SystemComponent["state"]): SystemComponent {
  return { key, state };
}

// --- queueComponentState -----------------------------------------------------

export function assertUnconfiguredQueueIsNotConfigured(): void {
  const state = queueComponentState({
    ...HEALTHY_QUEUE,
    configured: false,
    connected: false,
    lastHeartbeatAt: null,
    heartbeatStale: true,
  });
  assert(state === "not_configured", `no REDIS_URL must read not_configured, got ${state}`);
}

export function assertDisconnectedQueueIsDegraded(): void {
  const state = queueComponentState({ ...HEALTHY_QUEUE, connected: false });
  assert(state === "degraded", `a configured, disconnected queue must read degraded, got ${state}`);
}

export function assertStaleHeartbeatQueueIsDegraded(): void {
  const state = queueComponentState({ ...HEALTHY_QUEUE, heartbeatStale: true });
  assert(state === "degraded", `a stale heartbeat must read degraded, got ${state}`);
}

export function assertHealthyQueueIsOk(): void {
  const state = queueComponentState(HEALTHY_QUEUE);
  assert(state === "ok", `connected with a fresh heartbeat must read ok, got ${state}`);
}

// --- storageComponentState ---------------------------------------------------

export function assertUnconfiguredStorageIsNotConfigured(): void {
  const state = storageComponentState({ configured: false, reachable: false, bucket: null });
  assert(state === "not_configured", `unconfigured storage must read not_configured, got ${state}`);
}

export function assertUnreachableStorageIsDegraded(): void {
  const state = storageComponentState({ ...HEALTHY_STORAGE, reachable: false });
  assert(state === "degraded", `configured, unreachable storage must read degraded, got ${state}`);
}

export function assertReachableStorageIsOk(): void {
  const state = storageComponentState(HEALTHY_STORAGE);
  assert(state === "ok", `reachable storage must read ok, got ${state}`);
}

// --- fieldDataState ----------------------------------------------------------

export function assertNoMqttAssetIsNotMonitored(): void {
  const state = fieldDataState({ mqttAssets: 0, mqttFresh: 0 });
  assert(state === "not_monitored", `no mqtt asset in scope must read not_monitored, got ${state}`);
}

export function assertNoFreshMqttAssetIsDegraded(): void {
  const state = fieldDataState({ mqttAssets: 3, mqttFresh: 0 });
  assert(state === "degraded", `mqtt assets with none fresh must read degraded, got ${state}`);
}

export function assertOneFreshMqttAssetIsOk(): void {
  const state = fieldDataState({ mqttAssets: 3, mqttFresh: 1 });
  assert(state === "ok", `at least one fresh mqtt asset must read ok, got ${state}`);
}

// --- verdict -----------------------------------------------------------------

export function assertAllOkIsOperational(): void {
  const status = verdict([
    component("queue", "ok"),
    component("storage", "ok"),
    component("field_data", "ok"),
  ]);
  assert(status === "operational", `every component ok must read operational, got ${status}`);
}

export function assertOneDegradedIsDegraded(): void {
  const status = verdict([
    component("queue", "ok"),
    component("storage", "degraded"),
    component("field_data", "ok"),
  ]);
  assert(status === "degraded", `one degraded component must read degraded, got ${status}`);
}

export function assertNotConfiguredAndNotMonitoredAreOperational(): void {
  const status = verdict([
    component("queue", "not_configured"),
    component("storage", "not_configured"),
    component("field_data", "not_monitored"),
  ]);
  assert(
    status === "operational",
    `not_configured and not_monitored must never degrade the verdict, got ${status}`,
  );
}

// --- dataQualityPercent ------------------------------------------------------

export function assertOneOfThreeIs33Point3(): void {
  const percent = dataQualityPercent(1, 3);
  assert(percent === 33.3, `1 of 3 must read 33.3, got ${percent}`);
}

export function assertZeroStreamingIsNull(): void {
  const percent = dataQualityPercent(0, 0);
  assert(percent === null, `no streaming asset must read null, never 0 or 100, got ${percent}`);
}

export function assertAllFreshIs100(): void {
  const percent = dataQualityPercent(152, 152);
  assert(percent === 100, `152 of 152 must read 100, got ${percent}`);
}
