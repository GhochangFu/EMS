import { beforeAll, describe, it, vi } from "vitest";

/**
 * `F3.11` — Vitest entry point for `RuleSweepService`'s pool wiring.
 * Assertions live in the sibling `.spec` (§4.6/ADR 0014); this file only
 * runs them.
 *
 * The four `vi.mock`s are here rather than in the spec because `vi.mock` is
 * hoisted above the imports and only a Vitest file may declare it (the
 * `worker-host.service.test.ts` precedent). `./rule-sweep` captures the deps
 * `run()` composes; the other three record the handle each dep passes on.
 */
const recorded = vi.hoisted(() => ({
  deps: null as unknown,
  batchedFirstArgs: [] as unknown[],
  withTenantArgs: [] as (readonly [unknown, unknown])[],
}));

vi.mock("./rule-sweep", () => ({
  runRuleSweep: async (deps: unknown) => {
    recorded.deps = deps;
    return { finishedAt: "1970-01-01T00:00:00.000Z", evaluated: 0, raised: 0, durationMs: 0 };
  },
}));

vi.mock("./rule-reads", () => ({
  selectRuleRows: async () => [],
  stampRulesEvaluated: async () => undefined,
}));

vi.mock("./rule-samples", () => ({
  batchedLatestPointValues: async (db: unknown) => {
    recorded.batchedFirstArgs.push(db);
    return async () => null;
  },
}));

vi.mock("../database/tenant-context", () => ({
  withTenant: async (db: unknown, organizationId: unknown, fn: (tx: unknown) => Promise<unknown>) => {
    recorded.withTenantArgs.push([db, organizationId]);
    return fn({ tx: "with-tenant-tx" });
  },
}));

import {
  assertLoadSamplesRunsOnTheTenantPool,
  assertReadRulesRunsOnTheFleetHandle,
  assertStampEvaluatedRunsUnderTheOrganizationOnTheTenantPool,
  runSweepServiceOnce,
} from "./rule-sweep.service.spec";

describe("F3.11 — RuleSweepService composes its deps on the right pools", () => {
  beforeAll(async () => {
    await runSweepServiceOnce();
  });

  it("readRules opens its transaction on run()'s fleet handle", async () => {
    await assertReadRulesRunsOnTheFleetHandle(recorded);
  });

  it("loadSamples hands batchedLatestPointValues the tenant pool", async () => {
    await assertLoadSamplesRunsOnTheTenantPool(recorded);
  });

  it("stampEvaluated runs withTenant on the tenant pool under the organization", async () => {
    await assertStampEvaluatedRunsUnderTheOrganizationOnTheTenantPool(recorded);
  });
});
