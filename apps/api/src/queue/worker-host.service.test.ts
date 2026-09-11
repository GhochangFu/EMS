import { beforeAll, describe, it, vi } from "vitest";

/**
 * F4.24 (ADR 0063 decision 6) — Vitest entry point for the pool mapping in
 * `WorkerHostService.onModuleInit` (review L1). Assertions live in the
 * sibling `.spec` (§4.6/ADR 0014); this file only runs them.
 *
 * The three `vi.mock`s are here rather than in the spec because `vi.mock` is
 * hoisted above the imports and only a Vitest file may declare it (the
 * `onboarding-prompt-budget.test.ts` precedent). They let `onModuleInit` run
 * with no Redis: `upsertSchedule` resolves, `runProcessor` records its
 * arguments, `startQueueWorkers` returns a closable handle. Everything else
 * in `./queue-registry` stays real.
 */
const recorded = vi.hoisted(() => ({ runProcessorCalls: [] as (readonly unknown[])[] }));

vi.mock("./queue-processor", () => ({
  runProcessor: (...args: readonly unknown[]) => {
    recorded.runProcessorCalls.push(args);
    return { decl: args[0], process: async () => undefined };
  },
}));

vi.mock("./queue-registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./queue-registry")>()),
  upsertSchedule: async () => undefined,
}));

vi.mock("./worker-host", () => ({
  startQueueWorkers: () => ({ close: async () => undefined }),
}));

import {
  assertRunProcessorReceivedTheFleetSentinelAsFleetDb,
  assertRunProcessorReceivedTheTenantSentinelAsTenantDb,
  initWorkerHost,
} from "./worker-host.service.spec";

describe("F4.24 — WorkerHostService hands runProcessor the pools by slot", () => {
  beforeAll(async () => {
    await initWorkerHost();
  });

  it("dbs.tenantDb is the TENANT_DRIZZLE slot's pool", () => {
    assertRunProcessorReceivedTheTenantSentinelAsTenantDb(recorded.runProcessorCalls);
  });

  it("dbs.fleetDb is the FLEET_DRIZZLE slot's pool", () => {
    assertRunProcessorReceivedTheFleetSentinelAsFleetDb(recorded.runProcessorCalls);
  });
});
