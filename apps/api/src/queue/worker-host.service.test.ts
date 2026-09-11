import { beforeAll, describe, it, vi } from "vitest";

/**
 * F4.24 (ADR 0063 decision 6) and F3.11 (ADR 0064 decisions 2, 6; ADR 0063
 * decision 12) — Vitest entry point for what `WorkerHostService.onModuleInit`
 * registers. Assertions live in the sibling `.spec` (§4.6/ADR 0014); this
 * file only runs them.
 *
 * The three `vi.mock`s are here rather than in the spec because `vi.mock` is
 * hoisted above the imports and only a Vitest file may declare it (the
 * `onboarding-prompt-budget.test.ts` precedent). They let `onModuleInit` run
 * with no Redis: `upsertSchedule` records `(decl.name, schedule)`,
 * `runProcessor` records its arguments, `startQueueWorkers` returns a
 * closable handle. Everything else in `./queue-registry` stays real.
 */
const recorded = vi.hoisted(() => ({
  runProcessorCalls: [] as (readonly unknown[])[],
  upsertScheduleCalls: [] as (readonly [string, { schedulerId: string; everyMs: number }])[],
  /** The queue names of the registrations `startQueueWorkers` was handed — what actually gets a `Worker`. */
  startedQueueNames: [] as string[],
}));

vi.mock("./queue-processor", () => ({
  runProcessor: (...args: readonly unknown[]) => {
    recorded.runProcessorCalls.push(args);
    return { decl: args[0], process: async () => undefined };
  },
}));

vi.mock("./queue-registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./queue-registry")>()),
  upsertSchedule: async (
    _client: unknown,
    decl: { name: string },
    schedule: { schedulerId: string; everyMs: number },
  ) => {
    recorded.upsertScheduleCalls.push([decl.name, schedule]);
  },
}));

vi.mock("./worker-host", () => ({
  startQueueWorkers: (
    _client: unknown,
    registrations: readonly { readonly decl: { readonly name: string } }[],
  ) => {
    recorded.startedQueueNames.push(...registrations.map((r) => r.decl.name));
    return { close: async () => undefined };
  },
}));

import {
  assertHeartbeatRegistrationReceivedTheFleetSentinelAsFleetDb,
  assertHeartbeatRegistrationReceivedTheTenantSentinelAsTenantDb,
  assertNoQueueIsStartedTwice,
  assertStartedQueueNamesEqualAllQueues,
  assertSweepHandlerRanTheSweepOnTheHandleItWasGiven,
  assertSweepHandlerWroteTheSummaryUnderTheSweepKey,
  assertSweepRegistrationReceivedTheFleetSentinelAsFleetDb,
  assertSweepRegistrationReceivedTheTenantSentinelAsTenantDb,
  assertSweepScheduleUpsertedAtTheConfiguredInterval,
  initWorkerHost,
  invokeSweepHandler,
  type WorkerHostProbe,
} from "./worker-host.service.spec";

describe("F4.24 / F3.11 — WorkerHostService registers one processor per declared queue, with the pools by slot", () => {
  let probe: WorkerHostProbe;

  beforeAll(async () => {
    probe = await initWorkerHost();
  });

  it("the heartbeat registration's dbs.tenantDb is the TENANT_DRIZZLE slot's pool", () => {
    assertHeartbeatRegistrationReceivedTheTenantSentinelAsTenantDb(recorded.runProcessorCalls);
  });

  it("the heartbeat registration's dbs.fleetDb is the FLEET_DRIZZLE slot's pool", () => {
    assertHeartbeatRegistrationReceivedTheFleetSentinelAsFleetDb(recorded.runProcessorCalls);
  });

  it("the rules-sweep registration's dbs.tenantDb is the TENANT_DRIZZLE slot's pool", () => {
    assertSweepRegistrationReceivedTheTenantSentinelAsTenantDb(recorded.runProcessorCalls);
  });

  it("the rules-sweep registration's dbs.fleetDb is the FLEET_DRIZZLE slot's pool", () => {
    assertSweepRegistrationReceivedTheFleetSentinelAsFleetDb(recorded.runProcessorCalls);
  });

  it("the set of queue names handed to startQueueWorkers equals the set of ALL_QUEUES names (decision 12: every declared queue has a consumer)", () => {
    assertStartedQueueNamesEqualAllQueues(recorded.startedQueueNames);
  });

  it("no queue is handed to startQueueWorkers twice", () => {
    assertNoQueueIsStartedTwice(recorded.startedQueueNames);
  });

  it('upsertSchedule received ("rules-sweep", { schedulerId: "rules-sweep", everyMs: 12345 }) — the configured interval, not a constant', () => {
    assertSweepScheduleUpsertedAtTheConfiguredInterval(recorded.upsertScheduleCalls);
  });

  describe("the rules-sweep handler, invoked with ({}, { db: FLEET_SENTINEL }) as runProcessor would for a fleet queue", () => {
    beforeAll(async () => {
      await invokeSweepHandler(recorded.runProcessorCalls);
    });

    it("hands ctx.db to RuleSweepService.run", () => {
      assertSweepHandlerRanTheSweepOnTheHandleItWasGiven(probe);
    });

    it("writes JSON.stringify(summary) under bms:rules-sweep:last", () => {
      assertSweepHandlerWroteTheSummaryUnderTheSweepKey(probe);
    });
  });
});
