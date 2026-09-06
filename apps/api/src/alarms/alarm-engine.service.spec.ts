// `reflect-metadata` first, and before `AlarmEngineService` is imported: the
// class carries `@Inject(FLEET_DRIZZLE)` on a constructor parameter, and that
// decorator calls `Reflect.defineMetadata` at module-evaluation time. Without
// the polyfill loaded the import itself throws, not the construction.
import "reflect-metadata";

import type { BmsDb } from "@bms/db";
import type { TelemetryReading } from "@bms/shared";

import type { DeliveryResult } from "../notifications/notification-transport";
import type { DispatchInput, NotificationsService } from "../notifications/notifications.service";
import { TelemetryBroadcastHub } from "../telemetry/telemetry-broadcast.hub";
import { until } from "../testing/until";
import { AlarmEngineService } from "./alarm-engine.service";
import type { AlarmRaiseResult, AlarmRaiser } from "./alarm-raise.service";

/**
 * `F3.7` — the streaming path's first tests (the class had none: CodeGraph
 * reported "no covering tests" for `AlarmEngineService`, `evaluateReadings`
 * and `ensureCachesFresh` at `d940dba`).
 *
 * Unit, with no database: what is under test is the *decision* the batch loop
 * makes about a rule's stored `action` and about `AlarmRaiseResult.raised`,
 * not the cache `SELECT` — that is the integration sibling's job, against the
 * real column added by this same unit.
 *
 * `until` rather than `await`: ADR 0041 decision 1 makes the dispatch
 * fire-and-forget, and the hub listener is `void this.evaluateReadings(...)`,
 * so `emitReadings` returns before any of it has run and there is nothing for
 * a spec to await. See `testing/until.ts`.
 */

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const ASSET_ID = "3a1f0000-0000-4000-8000-00000000a55e";
const ORG_ID = "3a1f0000-0000-4000-8000-00000000c0f0";
const POINT_KEY = "f37_unit_point";
const ALARM_ID = "a1";

/**
 * One row as `ensureCachesFresh`'s `select({...})` projects it — including the
 * `action` column this unit adds. Named field for field rather than spread
 * from a partial, so a projection that loses a column fails here.
 */
function cacheRow(id: string, code: string, action: unknown): Record<string, unknown> {
  return {
    id,
    assetId: ASSET_ID,
    pointKey: POINT_KEY,
    code,
    name: `F3.7 unit fixture — ${code}`,
    operator: "gte",
    thresholdValue: 1,
    severity: "warning",
    condition: {},
    organizationId: ORG_ID,
    assetOrganizationId: ORG_ID,
    action,
  };
}

const NOTIFY_ACTION = { type: "notify", target: "t" };
const TRACE_ONLY_ACTION = { type: "trace_only", target: "Operations" };

type Chain = {
  from: () => Chain;
  innerJoin: () => Chain;
  where: () => Chain;
  then: (resolve: (rows: unknown[]) => void) => void;
};

/**
 * A thenable that answers every Drizzle builder call with itself and resolves
 * to `rows` — the `selectChain` shape `rules.service.spec.ts:57-66` uses, with
 * `innerJoin` because the cache read joins `bms.assets` for the asset's org.
 */
function selectChain(rows: unknown[]): Chain {
  const chain: Chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    then: (resolve) => resolve(rows),
  };
  return chain;
}

function fakeFleetDb(rows: unknown[]): BmsDb {
  return { select: () => selectChain(rows) } as unknown as BmsDb;
}

/** Every raise the engine attempted, recorded at call time. */
type RaiseCall = { assetId: string; organizationId: string; ruleId: string; value: number };

function fakeRaiser(result: AlarmRaiseResult): { raiser: AlarmRaiser; raises: RaiseCall[] } {
  const raises: RaiseCall[] = [];
  const raiser = {
    raise: (assetId: string, organizationId: string, rule: { id: string }, value: number) => {
      raises.push({ assetId, organizationId, ruleId: rule.id, value });
      return Promise.resolve(result);
    },
  } as unknown as AlarmRaiser;
  return { raiser, raises };
}

function fakeNotifications(
  behaviour: () => Promise<DeliveryResult[]> = () => Promise.resolve([]),
): { notifications: NotificationsService; calls: DispatchInput[] } {
  const calls: DispatchInput[] = [];
  const notifications = {
    dispatch: (input: DispatchInput) => {
      calls.push(input);
      return behaviour();
    },
  } as unknown as NotificationsService;
  return { notifications, calls };
}

function reading(): TelemetryReading {
  return {
    time: new Date().toISOString(),
    assetId: ASSET_ID,
    pointKey: POINT_KEY,
    value: 42,
    unit: null,
  };
}

const RAISED: AlarmRaiseResult = {
  raised: true,
  alarmId: ALARM_ID,
  severity: "warning",
  message: "m",
};

const NOT_RAISED: AlarmRaiseResult = {
  raised: false,
  alarmId: null,
  severity: "warning",
  message: "m",
};

/**
 * Both directions in one batch: two rules match the same reading and both
 * raise, and only the `notify` one dispatches.
 *
 * **The `notify` rule is ordered LAST here on purpose.** The loop is
 * sequential, so observing its dispatch proves the `trace_only` rule ahead of
 * it was processed and dispatched nothing — a fixture with only a `notify`
 * rule would pass just as well against an engine that dispatched for every
 * rule it raised. (Case 2 below needs the opposite ordering, for a different
 * reason; neither is arbitrary.)
 */
export async function assertDispatchesOnlyForTheNotifyRule(): Promise<void> {
  const hub = new TelemetryBroadcastHub();
  const { raiser, raises } = fakeRaiser(RAISED);
  const { notifications, calls } = fakeNotifications();
  const service = new AlarmEngineService(
    hub,
    fakeFleetDb([
      cacheRow("rule-trace-only", "F37_UNIT_TRACE", TRACE_ONLY_ACTION),
      cacheRow("rule-notify", "F37_UNIT_NOTIFY", NOTIFY_ACTION),
    ]),
    raiser,
    notifications,
  );

  service.onModuleInit();
  hub.emitReadings([reading()]);

  // 3s, not `until`'s 5s default: vitest's own test timeout is also 5s, so a
  // default-bounded `until` loses the race and the failure reads "Test timed
  // out in 5000ms" instead of naming the condition that never held. Measured
  // on the mutation run for this file.
  await until(() => calls.length === 1, {
    timeoutMs: 3_000,
    label: "the notify rule's dispatch",
  });

  assert(
    raises.length === 2,
    `both matching rules must have raised — otherwise the trace_only rule's silence ` +
      `proves nothing about the action; got ${raises.length} raises`,
  );
  assert(
    calls.length === 1,
    `exactly one of the two raised rules may dispatch, got ${calls.length}`,
  );
  const [call] = calls;
  assert(call !== undefined, "the recorded dispatch disappeared");
  assert(
    call.ruleId === "rule-notify" && call.ruleCode === "F37_UNIT_NOTIFY",
    `the dispatch must be for the notify rule, got ${call.ruleId} / ${call.ruleCode}`,
  );
  assert(
    call.organizationId === ORG_ID,
    `the dispatch carries the RULE's own organization (notification_deliveries.` +
      `organization_id), got ${String(call.organizationId)}`,
  );
  assert(
    call.alarmId === ALARM_ID,
    `the dispatch must name the alarm the raise opened, got ${String(call.alarmId)}`,
  );
  assert(call.raised === true, "a transition dispatches with raised = true");
  assert(
    call.severity === "warning" && call.message === "m",
    "subject and body come from the raiser's result (plan D1), not from a second computation",
  );
}

/**
 * Owner ruling Q2 (2026-09-06): the streaming engine dispatches only when
 * `raised === true`. An already-open alarm re-observed on every batch — 5
 * batches/minute × 118 open rules on the dev database — must write nothing.
 *
 * **The `notify` rule is ordered FIRST here, with a `trace_only` sentinel
 * after it.** The loop `await`s each raise in turn and the fake raiser records
 * at call time, so observing the *sentinel's* raise proves the notify rule's
 * raise resolved AND the synchronous code after it — the guard, and the
 * `notifyOnRaise` a guardless engine would run — has already executed. The
 * negative is then a happens-after assertion rather than a drained sleep:
 * remove the `if (raised.raised)` guard and `calls.length` is 1 by the time
 * this resolves.
 */
export async function assertANonTransitionDispatchesNothing(): Promise<void> {
  const hub = new TelemetryBroadcastHub();
  const { raiser, raises } = fakeRaiser(NOT_RAISED);
  const { notifications, calls } = fakeNotifications();
  const service = new AlarmEngineService(
    hub,
    fakeFleetDb([
      cacheRow("rule-notify", "F37_UNIT_NOTIFY", NOTIFY_ACTION),
      cacheRow("rule-sentinel", "F37_UNIT_SENTINEL", TRACE_ONLY_ACTION),
    ]),
    raiser,
    notifications,
  );

  service.onModuleInit();
  hub.emitReadings([reading()]);

  await until(() => raises.length === 2, {
    timeoutMs: 3_000,
    label: "the sentinel rule's raise, which happens after the notify rule's guard",
  });

  assert(
    calls.length === 0,
    `a raise that opened no alarm must dispatch nothing on the streaming path ` +
      `(owner ruling Q2), got ${calls.length} dispatches`,
  );
}

/**
 * `F4.36`: one rule's failure must not abort the batch. `notifyOnRaise`'s own
 * `.catch` is what holds this, and the call sits inside the existing per-rule
 * `try` so the invariant stays visible at the call site.
 *
 * Three notify rules, a `dispatch` that rejects every time: all three are
 * dispatched. Waiting on the *dispatches* rather than on the raises is
 * deliberate — the third dispatch happens after the third raise resolves, so
 * a wait on `raises.length === 3` would assert before it.
 */
export async function assertARejectedDispatchDoesNotAbortTheBatch(): Promise<void> {
  const hub = new TelemetryBroadcastHub();
  const { raiser, raises } = fakeRaiser(RAISED);
  const { notifications, calls } = fakeNotifications(() =>
    Promise.reject(new Error("transport unreachable")),
  );
  const service = new AlarmEngineService(
    hub,
    fakeFleetDb([
      cacheRow("rule-a", "F37_UNIT_A", NOTIFY_ACTION),
      cacheRow("rule-b", "F37_UNIT_B", NOTIFY_ACTION),
      cacheRow("rule-c", "F37_UNIT_C", NOTIFY_ACTION),
    ]),
    raiser,
    notifications,
  );

  service.onModuleInit();
  hub.emitReadings([reading()]);

  await until(() => calls.length === 3, {
    timeoutMs: 3_000,
    label: "all three dispatches despite the first two rejecting",
  });

  assert(
    raises.length === 3,
    `every rule in the batch must still have been raised, got ${raises.length}`,
  );
  assert(
    calls.map((call) => call.ruleId).join(",") === "rule-a,rule-b,rule-c",
    `the batch must dispatch in rule order, got ${calls.map((call) => call.ruleId).join(",")}`,
  );
}
