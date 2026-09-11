import type { Logger } from "@nestjs/common";

import {
  MAX_RAISE_CLOCK_SKEW_MS,
  MAX_RAISE_SAMPLE_AGE_MS,
  type AlarmRaiseResult,
  type AlarmRaiseRule,
} from "../alarms/alarm-raise.service";
import type { DispatchInput } from "../notifications/notifications.service";
import { runRuleSweep, type RuleSweepDeps } from "./rule-sweep";
import type { RuleRow } from "./rules.types";

/**
 * `F3.11` (ADR 0064 decisions 1, 5, 9; Amendment 1 A4) — the sweep body,
 * pure over its deps. Assertions live here; the sibling `.test` is the
 * Vitest entry point (ADR 0014) and runs `RULE_SWEEP_CASES` one `it()` each,
 * so a later claim is never hidden behind an earlier throw.
 *
 * Every case builds its own harness: a recording raiser, a recording
 * `dispatch`, a recording `stampEvaluated`, a stepping clock and a logger
 * that keeps each `warn`'s arguments. Nothing here touches a database.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const EPOCH = new Date("2026-01-01T00:00:00.000Z");
const NOW_MS = EPOCH.getTime();

/** The `rule-evaluation.spec.ts` fixture: a published, enabled threshold rule with a fresh sample match. */
function ruleRow(overrides: Partial<RuleRow> = {}): RuleRow {
  return {
    id: "rule-1",
    code: "RULE-1",
    name: "Feeder overload",
    description: null,
    category: "safety",
    ruleType: "threshold",
    source: "operator_rule",
    enabled: true,
    organizationId: "org-1",
    assetOrganizationId: "org-1",
    assetId: "asset-1",
    assetCode: "ASSET-1",
    assetName: "Feeder 1",
    siteName: "Site A",
    assetDomain: "electrical",
    pointKey: "kw",
    operator: "gt",
    thresholdValue: 100,
    severity: "warning",
    clearHoldSeconds: null,
    condition: { window: "latest" },
    action: { type: "trace_only", target: "Operations" },
    lastEvaluatedAt: null,
    lifecycleStatus: "published",
    publishedAt: null,
    archivedAt: null,
    duplicatedFromRuleId: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...overrides,
  };
}

type Sample = { time: Date; value: number; unit: string | null };

type RaiseCall = {
  assetId: string;
  organizationId: string;
  rule: AlarmRaiseRule;
  value: number;
  opts: unknown;
};

type StampCall = { organizationId: string; ruleIds: string[]; at: Date };

type Harness = {
  deps: RuleSweepDeps;
  raiseCalls: RaiseCall[];
  dispatchCalls: DispatchInput[];
  stampCalls: StampCall[];
  warns: unknown[][];
};

const RAISED: AlarmRaiseResult = {
  raised: true,
  alarmId: "alarm-1",
  severity: "warning",
  message: "Feeder overload matched at 150",
};

/** A sample that matches `ruleRow()`'s `kw > 100`, timestamped at the sweep's clock. */
const FRESH_MATCH: Sample = { time: EPOCH, value: 150, unit: "kW" };

/**
 * A clock that answers the listed instants in order and repeats the last one
 * once the list is spent, so the summary's arithmetic is over known values.
 */
function steppingClock(instants: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = instants[Math.min(index, instants.length - 1)] ?? NOW_MS;
    index += 1;
    return value;
  };
}

function harness(opts: {
  rows: RuleRow[];
  sample?: (assetId: string, pointKey: string) => Sample | null;
  raise?: (call: RaiseCall) => Promise<AlarmRaiseResult>;
  stamp?: (call: StampCall) => Promise<void>;
  clock?: readonly number[];
}): Harness {
  const raiseCalls: RaiseCall[] = [];
  const dispatchCalls: DispatchInput[] = [];
  const stampCalls: StampCall[] = [];
  const warns: unknown[][] = [];
  const sample = opts.sample ?? (() => FRESH_MATCH);
  const raise = opts.raise ?? (async () => RAISED);
  const stamp = opts.stamp ?? (async () => undefined);
  const logger = {
    warn: (...args: unknown[]) => {
      warns.push(args);
    },
    log: () => undefined,
  } as unknown as Pick<Logger, "warn" | "log">;
  const deps: RuleSweepDeps = {
    readRules: async () => opts.rows,
    loadSamples: async () => async (assetId, pointKey) => sample(assetId, pointKey),
    raiser: {
      raise: async (assetId, organizationId, rule, value, raiseOpts) => {
        const call = { assetId, organizationId, rule, value, opts: raiseOpts };
        raiseCalls.push(call);
        return raise(call);
      },
    },
    notifications: {
      dispatch: async (input) => {
        dispatchCalls.push(input);
        return [];
      },
    },
    stampEvaluated: async (organizationId, ruleIds, at) => {
      const call = { organizationId, ruleIds, at };
      stampCalls.push(call);
      return stamp(call);
    },
    logger,
    now: steppingClock(opts.clock ?? [NOW_MS]),
  };
  return { deps, raiseCalls, dispatchCalls, stampCalls, warns };
}

const NOTIFY = { type: "notify", target: "Operations" };

// ---------------------------------------------------------------------------
// Row 1 — the filter
// ---------------------------------------------------------------------------

async function fourRowsTwoEligible(): Promise<void> {
  const h = harness({
    rows: [
      ruleRow({ id: "off", enabled: false }),
      ruleRow({ id: "draft", lifecycleStatus: "draft" }),
      ruleRow({ id: "a" }),
      ruleRow({ id: "b" }),
    ],
    sample: () => null,
  });
  const summary = await runRuleSweep(h.deps);
  assert(
    summary.evaluated === 2,
    `expected only the enabled+published rows to be evaluated (2), got ${summary.evaluated} — the filter was dropped`,
  );
}

// ---------------------------------------------------------------------------
// Row 2 — a rule with no organization is skipped, not counted
// ---------------------------------------------------------------------------

async function nullOrgRuleIsNotCounted(): Promise<void> {
  const h = harness({ rows: [ruleRow({ id: "orphan", code: "ORPHAN-1", organizationId: null })] });
  const summary = await runRuleSweep(h.deps);
  assert(
    summary.evaluated === 0 && h.raiseCalls.length === 0,
    `expected a rule with no organization_id to be skipped uncounted, got evaluated=${summary.evaluated} raises=${h.raiseCalls.length}`,
  );
}

async function nullOrgRuleWarnNamesCodeAndId(): Promise<void> {
  const h = harness({ rows: [ruleRow({ id: "orphan", code: "ORPHAN-1", organizationId: null })] });
  await runRuleSweep(h.deps);
  const line = h.warns.map((args) => String(args[0])).find((s) => s.includes("no organization_id"));
  assert(
    line !== undefined && line.includes("ORPHAN-1") && line.includes("orphan"),
    `expected one warn naming the skipped rule's code and id, got ${JSON.stringify(h.warns)}`,
  );
}

// ---------------------------------------------------------------------------
// Row 3 — a fresh threshold match raises once, with the sweep's opts only
// ---------------------------------------------------------------------------

async function freshMatchRaisesOnce(): Promise<void> {
  const h = harness({ rows: [ruleRow()] });
  await runRuleSweep(h.deps);
  assert(
    h.raiseCalls.length === 1,
    `expected exactly one raise for a fresh threshold match, got ${h.raiseCalls.length}`,
  );
}

async function raiseOptsAreRaisedByRuleSweepOnly(): Promise<void> {
  const h = harness({ rows: [ruleRow()] });
  await runRuleSweep(h.deps);
  const opts = h.raiseCalls[0]?.opts;
  assert(
    JSON.stringify(opts) === JSON.stringify({ raisedBy: "rule_sweep" }),
    `expected raise opts to deep-equal { raisedBy: "rule_sweep" } (the engine's default trace, decision 5), got ${JSON.stringify(opts)}`,
  );
}

// ---------------------------------------------------------------------------
// Rows 4 and 5 — dispatch on a transition only (decision 5)
// ---------------------------------------------------------------------------

async function raisedTrueDispatchesOnce(): Promise<void> {
  const h = harness({ rows: [ruleRow({ action: NOTIFY })] });
  await runRuleSweep(h.deps);
  assert(
    h.dispatchCalls.length === 1,
    `expected one dispatch for a notify rule whose raise transitioned, got ${h.dispatchCalls.length}`,
  );
}

async function raisedTrueCountsOne(): Promise<void> {
  const h = harness({ rows: [ruleRow({ action: NOTIFY })] });
  const summary = await runRuleSweep(h.deps);
  assert(summary.raised === 1, `expected raised === 1, got ${summary.raised}`);
}

async function raisedFalseDoesNotDispatch(): Promise<void> {
  const h = harness({
    rows: [ruleRow({ action: NOTIFY })],
    raise: async () => ({ ...RAISED, raised: false }),
  });
  await runRuleSweep(h.deps);
  assert(
    h.dispatchCalls.length === 0,
    `expected no dispatch on raised: false (the engine's transition rule, not the press's every-attempt policy), got ${h.dispatchCalls.length}`,
  );
}

async function raisedFalseCountsZero(): Promise<void> {
  const h = harness({
    rows: [ruleRow({ action: NOTIFY })],
    raise: async () => ({ ...RAISED, raised: false }),
  });
  const summary = await runRuleSweep(h.deps);
  assert(summary.raised === 0, `expected raised === 0 on a deduped raise, got ${summary.raised}`);
}

// ---------------------------------------------------------------------------
// Rows 6 and 7 — the two-sided freshness bound on every raise
// ---------------------------------------------------------------------------

async function staleSampleDoesNotRaise(): Promise<void> {
  const h = harness({
    rows: [ruleRow()],
    sample: () => ({ ...FRESH_MATCH, time: new Date(NOW_MS - MAX_RAISE_SAMPLE_AGE_MS - 1) }),
  });
  await runRuleSweep(h.deps);
  assert(
    h.raiseCalls.length === 0,
    `expected no raise from a sample older than MAX_RAISE_SAMPLE_AGE_MS, got ${h.raiseCalls.length}`,
  );
}

async function futureSampleDoesNotRaise(): Promise<void> {
  const h = harness({
    rows: [ruleRow()],
    sample: () => ({ ...FRESH_MATCH, time: new Date(NOW_MS + MAX_RAISE_CLOCK_SKEW_MS + 1) }),
  });
  await runRuleSweep(h.deps);
  assert(
    h.raiseCalls.length === 0,
    `expected no raise from a sample further ahead than MAX_RAISE_CLOCK_SKEW_MS, got ${h.raiseCalls.length}`,
  );
}

// ---------------------------------------------------------------------------
// Row 8 — a matched time-window rule is evaluated but never raises
// ---------------------------------------------------------------------------

/** Every day, all day — matched at any instant, so `shouldRaise` alone decides. */
const ALL_WEEK_WINDOW = ruleRow({
  ruleType: "time_window",
  condition: {
    days: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
    startTime: "00:00",
    endTime: "23:59",
  },
});

async function timeWindowMatchDoesNotRaise(): Promise<void> {
  const h = harness({ rows: [ALL_WEEK_WINDOW] });
  await runRuleSweep(h.deps);
  assert(
    h.raiseCalls.length === 0,
    `expected a matched time_window rule not to raise (shouldRaise is threshold-only), got ${h.raiseCalls.length}`,
  );
}

async function timeWindowMatchIsCounted(): Promise<void> {
  const h = harness({ rows: [ALL_WEEK_WINDOW] });
  const summary = await runRuleSweep(h.deps);
  assert(summary.evaluated === 1, `expected the time_window rule to count as evaluated, got ${summary.evaluated}`);
}

// ---------------------------------------------------------------------------
// Row 9 — the E7.1b guard: no asset organization, no raise
// ---------------------------------------------------------------------------

async function nullAssetOrgDoesNotRaise(): Promise<void> {
  const h = harness({ rows: [ruleRow({ assetOrganizationId: null })] });
  await runRuleSweep(h.deps);
  assert(
    h.raiseCalls.length === 0,
    `expected no raise for a threshold rule whose asset has no organization, got ${h.raiseCalls.length}`,
  );
}

// ---------------------------------------------------------------------------
// Row 10 — an unsupported rule type is an error result, counted, never thrown
// ---------------------------------------------------------------------------

async function bogusRuleTypeIsCounted(): Promise<void> {
  const h = harness({ rows: [ruleRow({ ruleType: "bogus" })] });
  const summary = await runRuleSweep(h.deps);
  assert(summary.evaluated === 1, `expected the unsupported rule to count as evaluated, got ${summary.evaluated}`);
}

async function bogusRuleTypeDoesNotRaise(): Promise<void> {
  const h = harness({ rows: [ruleRow({ ruleType: "bogus" })] });
  await runRuleSweep(h.deps);
  assert(h.raiseCalls.length === 0, `expected no raise for an unsupported rule type, got ${h.raiseCalls.length}`);
}

// ---------------------------------------------------------------------------
// Row 11 — per-rule isolation: A's raise rejects, B still runs
// ---------------------------------------------------------------------------

function aRejectsThenB(): Harness {
  return harness({
    rows: [ruleRow({ id: "A" }), ruleRow({ id: "B" })],
    raise: async (call) => {
      if (call.rule.id === "A") {
        throw new Error("raise exploded");
      }
      return RAISED;
    },
  });
}

async function ruleARejectsRuleBStillRaises(): Promise<void> {
  const h = aRejectsThenB();
  const summary = await runRuleSweep(h.deps);
  assert(
    h.raiseCalls.some((c) => c.rule.id === "B") && summary.raised === 1,
    `expected rule B to raise after rule A's raise rejected, got raises=${JSON.stringify(h.raiseCalls.map((c) => c.rule.id))} raised=${summary.raised}`,
  );
}

async function ruleARejectsWarnsOnceWithItsId(): Promise<void> {
  const h = aRejectsThenB();
  await runRuleSweep(h.deps);
  const failures = h.warns.filter((args) => {
    const first = args[0];
    return typeof first === "object" && first !== null && (first as { ruleId?: unknown }).ruleId === "A";
  });
  assert(
    failures.length === 1 && h.warns.length === 1,
    `expected exactly one warn whose object carries ruleId: "A", got ${JSON.stringify(h.warns)}`,
  );
}

async function ruleARejectsBothAreCounted(): Promise<void> {
  const h = aRejectsThenB();
  const summary = await runRuleSweep(h.deps);
  assert(summary.evaluated === 2, `expected evaluated === 2 (A evaluated before its raise failed), got ${summary.evaluated}`);
}

// ---------------------------------------------------------------------------
// Rows 12 and 13 — one stamp per organization, over the completed ids only
// ---------------------------------------------------------------------------

function twoOrgs(): Harness {
  return harness({
    rows: [
      ruleRow({ id: "r1", organizationId: "org-1", assetOrganizationId: "org-1" }),
      ruleRow({ id: "r2", organizationId: "org-1", assetOrganizationId: "org-1" }),
      ruleRow({ id: "r3", organizationId: "org-2", assetOrganizationId: "org-2" }),
    ],
  });
}

async function stampIsCalledExactlyOncePerOrganization(): Promise<void> {
  const h = twoOrgs();
  await runRuleSweep(h.deps);
  assert(
    h.stampCalls.length === 2,
    `expected stampEvaluated exactly twice for three rules in two organizations, got ${h.stampCalls.length}`,
  );
}

async function stampCarriesEachOrganizationsIds(): Promise<void> {
  const h = twoOrgs();
  await runRuleSweep(h.deps);
  const byOrg = Object.fromEntries(h.stampCalls.map((c) => [c.organizationId, [...c.ruleIds].sort()]));
  assert(
    JSON.stringify(byOrg) === JSON.stringify({ "org-1": ["r1", "r2"], "org-2": ["r3"] }),
    `expected each stamp to carry its own organization's ids, got ${JSON.stringify(byOrg)}`,
  );
}

async function stampsShareOneAt(): Promise<void> {
  const h = twoOrgs();
  await runRuleSweep(h.deps);
  const ats = new Set(h.stampCalls.map((c) => c.at.getTime()));
  assert(
    h.stampCalls.length === 2 && ats.size === 1,
    `expected both stamps to carry the same finishedAt, got ${JSON.stringify([...ats])}`,
  );
}

async function failedRuleIsNotStamped(): Promise<void> {
  const h = aRejectsThenB();
  await runRuleSweep(h.deps);
  const stamped = h.stampCalls.flatMap((c) => c.ruleIds);
  assert(
    !stamped.includes("A") && stamped.includes("B"),
    `expected the failed rule A absent from its organization's stamp and B present, got ${JSON.stringify(stamped)}`,
  );
}

// ---------------------------------------------------------------------------
// Row 14 — one organization's stamp failing does not abort the rest
// ---------------------------------------------------------------------------

function org1StampRejects(): Harness {
  return harness({
    rows: [
      ruleRow({ id: "r1", organizationId: "org-1", assetOrganizationId: "org-1" }),
      ruleRow({ id: "r3", organizationId: "org-2", assetOrganizationId: "org-2" }),
    ],
    stamp: async (call) => {
      if (call.organizationId === "org-1") {
        throw new Error("stamp exploded");
      }
    },
  });
}

async function stampRejectsForOrg1Org2StillStamped(): Promise<void> {
  const h = org1StampRejects();
  await runRuleSweep(h.deps);
  assert(
    h.stampCalls.some((c) => c.organizationId === "org-2"),
    `expected org-2 stamped after org-1's stamp rejected, got ${JSON.stringify(h.stampCalls.map((c) => c.organizationId))}`,
  );
}

async function stampRejectsWarnsOnceWithTheOrganization(): Promise<void> {
  const h = org1StampRejects();
  await runRuleSweep(h.deps);
  const stampWarns = h.warns.filter((args) => {
    const first = args[0];
    return (
      typeof first === "object" && first !== null && (first as { organizationId?: unknown }).organizationId === "org-1"
    );
  });
  assert(
    stampWarns.length === 1 && h.warns.length === 1,
    `expected exactly one warn carrying organizationId: "org-1", got ${JSON.stringify(h.warns)}`,
  );
}

// ---------------------------------------------------------------------------
// Row 15 — the summary is built from the injected clock
// ---------------------------------------------------------------------------

/** started, the evaluation instant, finishedAt, the duration read — four reads. */
const CLOCK = [1000, 1100, 1300, 1412] as const;

function clockedRun(): Harness {
  return harness({ rows: [ruleRow({ action: NOTIFY })], clock: CLOCK, sample: () => ({ ...FRESH_MATCH, time: new Date(1100) }) });
}

async function durationIsFromTheClock(): Promise<void> {
  const h = clockedRun();
  const summary = await runRuleSweep(h.deps);
  assert(summary.durationMs === 412, `expected durationMs === 412 from the clock 1000 → 1412, got ${summary.durationMs}`);
}

async function finishedAtIsThePenultimateInstant(): Promise<void> {
  const h = clockedRun();
  const summary = await runRuleSweep(h.deps);
  assert(
    summary.finishedAt === new Date(1300).toISOString(),
    `expected finishedAt to be the ISO of the penultimate now() (1300), got ${summary.finishedAt}`,
  );
}

async function countsMatchTheRun(): Promise<void> {
  const h = clockedRun();
  const summary = await runRuleSweep(h.deps);
  assert(
    summary.evaluated === 1 && summary.raised === 1,
    `expected evaluated 1 / raised 1 for one fresh match, got ${summary.evaluated}/${summary.raised}`,
  );
}

// ---------------------------------------------------------------------------
// The table the wrapper runs, one `it()` per entry
// ---------------------------------------------------------------------------

export const RULE_SWEEP_CASES: readonly { readonly name: string; readonly run: () => Promise<void> }[] = [
  { name: "four rows (disabled, draft, published+enabled x2) evaluate 2", run: fourRowsTwoEligible },
  { name: "a rule with no organization_id is skipped and not counted", run: nullOrgRuleIsNotCounted },
  { name: "the skip warn names the rule's code and id", run: nullOrgRuleWarnNamesCodeAndId },
  { name: "a fresh threshold match raises exactly once", run: freshMatchRaisesOnce },
  { name: "raise opts deep-equal { raisedBy: 'rule_sweep' } and nothing else", run: raiseOptsAreRaisedByRuleSweepOnly },
  { name: "raised: true with a notify action dispatches once", run: raisedTrueDispatchesOnce },
  { name: "raised: true counts raised === 1", run: raisedTrueCountsOne },
  { name: "raised: false does not dispatch", run: raisedFalseDoesNotDispatch },
  { name: "raised: false counts raised === 0", run: raisedFalseCountsZero },
  { name: "a sample MAX_RAISE_SAMPLE_AGE_MS + 1 old does not raise", run: staleSampleDoesNotRaise },
  { name: "a sample MAX_RAISE_CLOCK_SKEW_MS + 1 ahead does not raise", run: futureSampleDoesNotRaise },
  { name: "a matched time_window rule does not raise", run: timeWindowMatchDoesNotRaise },
  { name: "a matched time_window rule is counted as evaluated", run: timeWindowMatchIsCounted },
  { name: "a threshold rule with assetOrganizationId null does not raise", run: nullAssetOrgDoesNotRaise },
  { name: "ruleType 'bogus' is counted", run: bogusRuleTypeIsCounted },
  { name: "ruleType 'bogus' does not raise and does not throw", run: bogusRuleTypeDoesNotRaise },
  { name: "rule A's raise rejects, rule B still raises", run: ruleARejectsRuleBStillRaises },
  { name: "rule A's rejection is one warn carrying ruleId: A", run: ruleARejectsWarnsOnceWithItsId },
  { name: "rule A's rejection still counts both rules as evaluated", run: ruleARejectsBothAreCounted },
  { name: "three rules in two organizations stamp exactly twice", run: stampIsCalledExactlyOncePerOrganization },
  { name: "each stamp carries its own organization's ids", run: stampCarriesEachOrganizationsIds },
  { name: "both stamps carry the same at", run: stampsShareOneAt },
  { name: "the failed rule's id is absent from its organization's stamp", run: failedRuleIsNotStamped },
  { name: "org-1's stamp rejects, org-2 is still stamped", run: stampRejectsForOrg1Org2StillStamped },
  { name: "org-1's stamp rejection is one warn carrying organizationId", run: stampRejectsWarnsOnceWithTheOrganization },
  { name: "durationMs is 412 from the clock 1000 -> 1412", run: durationIsFromTheClock },
  { name: "finishedAt is the ISO of the penultimate now()", run: finishedAtIsThePenultimateInstant },
  { name: "evaluated and raised are as counted", run: countsMatchTheRun },
];
