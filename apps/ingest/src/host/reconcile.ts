import type { IngestProtocol } from "@bms/shared/ingest";

import type { AdapterLogger } from "../adapter/types.js";
import { endpointGroupKey, type EndpointPlan } from "./bindings.js";
import type { PointIndex } from "./normaliser.js";
import type { Supervisor, SupervisorHealth } from "./supervisor.js";

/**
 * Reload reconciliation — the endpoint set follows the binding plan (ADR 0115
 * decision 6, amending ADR 0016).
 *
 * ADR 0016 declined this as "a second state machine on top of the
 * supervisor's". It is kept out of the supervisor on purpose: the registry only
 * ever starts, stops or replaces **whole** supervisors through their existing
 * `start()` and `stop()`, so no supervisor ever learns that its bindings
 * changed. Two halves:
 *
 * - `diffEndpoints` — **pure**: running device sets plus the next plan in, an
 *   ordered list of actions out. No clock, no I/O, no mutation.
 * - `createEndpointRegistry` — applies those actions one at a time, owns the
 *   running supervisors and the point index each one reads, and is the only
 *   thing `main.ts` asks for the health roster.
 *
 * **What is not detected.** A connection-config or credential change on a
 * running endpoint whose device set is unchanged is a `swap-index`, so it still
 * needs a restart (plan R5): detecting it would mean fingerprinting the
 * plaintext credentials (AGENTS.md §9.6).
 */

export type ReconcileAction =
  | { readonly kind: "start"; readonly key: string; readonly plan: EndpointPlan }
  | {
      readonly kind: "replace";
      readonly key: string;
      readonly plan: EndpointPlan;
      readonly added: readonly string[];
      readonly removed: readonly string[];
    }
  | { readonly kind: "stop"; readonly key: string }
  | { readonly kind: "swap-index"; readonly key: string; readonly pointIndex: PointIndex };

function byKey(a: { key: string }, b: { key: string }): number {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * What the reload must do to turn `running` into `next`, per
 * `endpointGroupKey(protocol, endpointKey)`.
 *
 * **Order (plan R10).** Every `stop` and `replace` comes first, then every
 * `swap-index`, then every `start`, each group sorted by key. A broker may
 * refuse a duplicate client id, so whatever closes a connection runs before
 * anything that dials one.
 *
 * `next` comes from `planEndpoints`, which yields one plan per key; were a key
 * to repeat, the last plan for it would win.
 */
export function diffEndpoints(
  running: ReadonlyMap<string, ReadonlySet<string>>,
  next: readonly EndpointPlan[],
): readonly ReconcileAction[] {
  const wanted = new Map<string, EndpointPlan>();
  for (const plan of next) {
    wanted.set(endpointGroupKey(plan.protocol, plan.endpointKey), plan);
  }

  const closing: ReconcileAction[] = [];
  const swaps: ReconcileAction[] = [];
  const starts: ReconcileAction[] = [];

  for (const key of running.keys()) {
    if (!wanted.has(key)) {
      closing.push({ kind: "stop", key });
    }
  }
  for (const [key, plan] of wanted) {
    const served = running.get(key);
    if (served === undefined) {
      starts.push({ kind: "start", key, plan });
      continue;
    }
    const devices = new Set(plan.bindings.map((binding) => binding.deviceKey));
    const added = [...devices].filter((d) => !served.has(d)).sort();
    const removed = [...served].filter((d) => !devices.has(d)).sort();
    if (added.length > 0 || removed.length > 0) {
      closing.push({ kind: "replace", key, plan, added, removed });
    } else {
      swaps.push({ kind: "swap-index", key, pointIndex: plan.pointIndex });
    }
  }

  return [...closing.sort(byKey), ...swaps.sort(byKey), ...starts.sort(byKey)];
}

/** A stopped endpoint that still holds samples on disk (plan R7). */
export type StoppedEndpoint = {
  readonly protocol: IngestProtocol;
  readonly endpointKey: string;
  /** Samples, not bytes — the same unit as every other `buffered=` on the body. */
  readonly buffered: number;
};

export type EndpointRegistryDeps = {
  /**
   * Builds — does not start — the supervisor for one plan. `index` is read on
   * every write, so a `swap-index` reaches the running supervisor without a
   * rebuild. May throw; the registry logs it and carries on.
   */
  build(plan: EndpointPlan, index: () => PointIndex): Supervisor;
  logger: AdapterLogger;
  /** The disk-buffer gauge for one endpoint, in samples (`DiskBufferHandle.buffered`). */
  buffered(protocol: IngestProtocol, endpointKey: string): number;
  /**
   * Endpoints the disk-buffer scan found segments for at start-up
   * (`DiskBufferStore.backlog()`). Seeded as stopped, so after a host restart
   * the backlog of an endpoint the boot plan does not start — an organization
   * still switched off — is still named on the health body (ADR 0115
   * Amendment 1). One the boot plan starts leaves the list as it launches.
   */
  scanned?: readonly { readonly protocol: IngestProtocol; readonly endpointKey: string }[];
};

export type EndpointRegistry = {
  /**
   * Reconciles the running set with `next`. `"busy"` when the previous reload
   * is still applying — nothing is queued, because the next tick re-plans from
   * the database anyway (plan R6) — and after `stopAll`.
   */
  reload(next: readonly EndpointPlan[]): Promise<"applied" | "busy">;
  health(): { endpoints: readonly SupervisorHealth[]; stopped: readonly StoppedEndpoint[] };
  /** Waits for an in-flight reload, then stops every running supervisor. */
  stopAll(): Promise<void>;
};

type Running = {
  readonly plan: EndpointPlan;
  readonly devices: ReadonlySet<string>;
  readonly supervisor: Supervisor;
  /** What the supervisor's `index()` returns; a `swap-index` replaces `current`. */
  readonly slot: { current: PointIndex };
};

/** Log fields that identify an endpoint. Never the config or credentials (§9.6). */
function where(plan: { protocol: IngestProtocol; endpointKey: string }): Record<string, unknown> {
  return { protocol: plan.protocol, endpointKey: plan.endpointKey };
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createEndpointRegistry(deps: EndpointRegistryDeps): EndpointRegistry {
  const running = new Map<string, Running>();
  /** Keys stopped by a reload, so their backlog can be named until it is gone. */
  const stopped = new Map<string, { protocol: IngestProtocol; endpointKey: string }>();
  for (const endpoint of deps.scanned ?? []) {
    stopped.set(endpointGroupKey(endpoint.protocol, endpoint.endpointKey), {
      protocol: endpoint.protocol,
      endpointKey: endpoint.endpointKey,
    });
  }
  let applying: Promise<void> | undefined;
  let closed = false;

  /** Builds and starts one plan. Returns false (logged) when the build or start threw. */
  function launch(key: string, plan: EndpointPlan): boolean {
    const slot = { current: plan.pointIndex };
    let supervisor: Supervisor | undefined;
    try {
      supervisor = deps.build(plan, () => slot.current);
      supervisor.start();
    } catch (error) {
      // Built but refused to start: stop it, so nothing half-started keeps a
      // connection or a timer. `stop()` is idempotent and never rejects.
      if (supervisor !== undefined) {
        void supervisor.stop().catch(() => undefined);
      }
      // Not running, so the next reload sees the key absent and retries it.
      deps.logger.error("endpoint start failed", { ...where(plan), reason: reasonOf(error) });
      stopped.set(key, { protocol: plan.protocol, endpointKey: plan.endpointKey });
      return false;
    }
    running.set(key, {
      plan,
      devices: new Set(plan.bindings.map((binding) => binding.deviceKey)),
      supervisor,
      slot,
    });
    stopped.delete(key);
    return true;
  }

  /** Stops one running supervisor and drops it from the roster, whatever `stop()` does. */
  async function halt(key: string, current: Running): Promise<void> {
    try {
      await current.supervisor.stop();
    } catch (error) {
      // `Supervisor.stop()` is documented never to reject; if one does, the
      // key is still dropped so the plan, not a stuck supervisor, decides.
      deps.logger.error("endpoint stop failed", { ...where(current.plan), reason: reasonOf(error) });
    }
    running.delete(key);
    stopped.set(key, { protocol: current.plan.protocol, endpointKey: current.plan.endpointKey });
  }

  async function apply(next: readonly EndpointPlan[]): Promise<void> {
    const served = new Map<string, ReadonlySet<string>>();
    for (const [key, entry] of running) {
      served.set(key, entry.devices);
    }
    for (const action of diffEndpoints(served, next)) {
      const current = running.get(action.key);
      // Once `stopAll` has begun nothing new may dial: stops still run, a
      // replace still closes its old supervisor, but no launch follows.
      if (closed && action.kind === "start") {
        continue;
      }
      switch (action.kind) {
        case "stop": {
          if (current !== undefined) {
            // A queued tail written after this point resolves against no
            // mapping and is discarded (counted), rather than written for an
            // RTU that is no longer in the plan.
            current.slot.current = new Map();
            await halt(action.key, current);
            deps.logger.info("endpoint stopped", {
              ...where(current.plan),
              devices: current.devices.size,
            });
          }
          break;
        }
        case "replace": {
          // Plan R10: the old connection is closed before the new one dials.
          if (current !== undefined) {
            await halt(action.key, current);
          }
          if (closed) {
            break;
          }
          if (launch(action.key, action.plan)) {
            deps.logger.info("endpoint replaced", {
              ...where(action.plan),
              added: action.added,
              removed: action.removed,
              devices: action.plan.bindings.length,
            });
          }
          break;
        }
        case "swap-index": {
          if (current !== undefined) {
            current.slot.current = action.pointIndex;
          }
          break;
        }
        case "start": {
          if (launch(action.key, action.plan)) {
            deps.logger.info("endpoint started", {
              ...where(action.plan),
              devices: action.plan.bindings.length,
            });
          }
          break;
        }
      }
    }
  }

  return {
    async reload(next) {
      if (closed) {
        return "busy";
      }
      if (applying !== undefined) {
        deps.logger.warn("reload skipped; previous reload still applying");
        return "busy";
      }
      const run = apply(next);
      applying = run.finally(() => {
        applying = undefined;
      });
      await applying;
      return "applied";
    },

    health() {
      // Both lists by key, so a replace does not reorder the health body.
      const listed: StoppedEndpoint[] = [];
      for (const [key, endpoint] of [...stopped].sort(([a], [b]) => byKey({ key: a }, { key: b }))) {
        if (running.has(key)) {
          continue;
        }
        const buffered = deps.buffered(endpoint.protocol, endpoint.endpointKey);
        if (buffered > 0) {
          listed.push({ ...endpoint, buffered });
        }
      }
      return {
        endpoints: [...running]
          .sort(([a], [b]) => byKey({ key: a }, { key: b }))
          .map(([, entry]) => entry.supervisor.health()),
        stopped: listed,
      };
    },

    async stopAll() {
      closed = true;
      await applying?.catch(() => undefined);
      const all = [...running];
      running.clear();
      await Promise.allSettled(all.map(([, entry]) => entry.supervisor.stop()));
    },
  };
}
