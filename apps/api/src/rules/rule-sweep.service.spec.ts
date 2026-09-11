import "reflect-metadata";

import type { BmsDb } from "@bms/db";

import type { AlarmRaiser } from "../alarms/alarm-raise.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { RuleSweepDeps } from "./rule-sweep";
import { RuleSweepService } from "./rule-sweep.service";

/**
 * `F3.11` (ADR 0064 decisions 3, 6) — which pool each of `RuleSweepService`'s
 * three database deps runs on. The service injects the tenant pool only; the
 * fleet handle is `run(fleetDb)`'s argument, handed in by the processor
 * context. `runRuleSweep` is pure over its deps and cannot see a swap, so
 * this spec reads the deps the service composes and invokes each once.
 *
 * The `worker-host.service.spec.ts` pattern: no Nest module boots (§4.6), the
 * `.test.ts` wrapper `vi.mock`s `./rule-sweep` (to capture the deps),
 * `./rule-reads`, `./rule-samples` and `../database/tenant-context` (to record
 * their first arguments), and hands the recordings across. Three claims, one
 * function each — swap a pool and exactly one reddens.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Each sentinel's `transaction` records which pool was asked for one, so `readRules` on the wrong pool is visible. */
export const transactionOwners: string[] = [];

const TENANT_TX = { tx: "tenant-tx" };
const FLEET_TX = { tx: "fleet-tx" };

export const TENANT_SENTINEL = {
  pool: "tenant-sentinel",
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    transactionOwners.push("tenant");
    return fn(TENANT_TX);
  },
} as unknown as BmsDb;

export const FLEET_SENTINEL = {
  pool: "fleet-sentinel",
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    transactionOwners.push("fleet");
    return fn(FLEET_TX);
  },
} as unknown as BmsDb;

/** What the wrapper's mocks recorded. */
export type RecordedSweepWiring = {
  /** The deps object `run()` handed to the mocked `runRuleSweep`. */
  deps: unknown;
  /** `batchedLatestPointValues`'s first argument, one entry per call. */
  batchedFirstArgs: readonly unknown[];
  /** `withTenant`'s first two arguments, one entry per call. */
  withTenantArgs: readonly (readonly [unknown, unknown])[];
};

/** Constructs the service with the tenant sentinel in slot 0 and runs it once against the fleet sentinel. */
export async function runSweepServiceOnce(): Promise<void> {
  const service = new RuleSweepService(
    TENANT_SENTINEL,
    {} as AlarmRaiser,
    {} as NotificationsService,
  );
  await service.run(FLEET_SENTINEL);
}

function depsOf(recorded: RecordedSweepWiring): RuleSweepDeps {
  assert(
    recorded.deps !== null && typeof recorded.deps === "object",
    "expected run() to hand runRuleSweep one deps object — the mock captured nothing",
  );
  return recorded.deps as RuleSweepDeps;
}

export async function assertReadRulesRunsOnTheFleetHandle(
  recorded: RecordedSweepWiring,
): Promise<void> {
  await depsOf(recorded).readRules();
  assert(
    JSON.stringify(transactionOwners) === JSON.stringify(["fleet"]),
    `expected readRules to open its transaction on run()'s fleet handle (the cross-org read, ADR 0033 decision 2), got ${JSON.stringify(transactionOwners)}`,
  );
}

export async function assertLoadSamplesRunsOnTheTenantPool(
  recorded: RecordedSweepWiring,
): Promise<void> {
  await depsOf(recorded).loadSamples([]);
  assert(
    recorded.batchedFirstArgs.length === 1 && recorded.batchedFirstArgs[0] === TENANT_SENTINEL,
    "expected loadSamples to hand batchedLatestPointValues the TENANT_DRIZZLE slot's pool (telemetry.point_values has no 0047 policy; rule-samples.ts) — it received a different handle",
  );
}

export async function assertStampEvaluatedRunsUnderTheOrganizationOnTheTenantPool(
  recorded: RecordedSweepWiring,
): Promise<void> {
  await depsOf(recorded).stampEvaluated("org", ["r1"], new Date(0));
  const [db, organizationId] = recorded.withTenantArgs[0] ?? [undefined, undefined];
  assert(
    recorded.withTenantArgs.length === 1 && db === TENANT_SENTINEL && organizationId === "org",
    `expected stampEvaluated to run withTenant(TENANT_DRIZZLE pool, "org", …), got ${JSON.stringify(recorded.withTenantArgs.map(([d, o]) => [(d as { pool?: string } | undefined)?.pool, o]))}`,
  );
}
