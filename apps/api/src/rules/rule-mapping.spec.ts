import {
  asAction,
  asCondition,
  asTrace,
  mapRuleRow,
  mergeRuleDraft,
  ruleBodyFromRow,
} from "./rule-mapping";
import type { RuleRow } from "./rules.types";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const CREATED = new Date("2026-01-01T10:00:00.000Z");
const UPDATED = new Date("2026-02-02T11:30:00.000Z");

function ruleRow(overrides: Partial<RuleRow> = {}): RuleRow {
  return {
    id: "rule-1",
    code: "RULE-1",
    name: "Feeder overload",
    description: "Trips above 100 kW",
    category: "electrical",
    ruleType: "threshold",
    source: "operator_rule",
    enabled: true,
    assetId: "asset-1",
    assetCode: "ASSET-1",
    assetName: "Feeder 1",
    siteName: "Site A",
    pointKey: "kw",
    operator: "gt",
    thresholdValue: 100,
    severity: "warning",
    condition: { window: "latest", unit: "kW" },
    action: { type: "notify", target: "Operations" },
    lastEvaluatedAt: null,
    lifecycleStatus: "published",
    publishedAt: null,
    archivedAt: null,
    duplicatedFromRuleId: null,
    createdAt: CREATED,
    updatedAt: UPDATED,
    ...overrides,
  };
}

function testAsCondition(): void {
  const latest = asCondition({ window: "latest", unit: "kW" });
  assert("window" in latest && latest.window === "latest", "latest window survives");
  assert("unit" in latest && latest.unit === "kW", "a string unit survives");

  const noUnit = asCondition({ window: "latest", unit: 7 });
  assert("unit" in noUnit && noUnit.unit === undefined, "a non-string unit is dropped");

  const window = asCondition({
    days: ["mon", "tue"],
    startTime: "09:00",
    endTime: "17:00",
  });
  assert("days" in window && window.days.length === 2, "both days survive");
  assert("days" in window && window.startTime === "09:00", "the start time survives");

  // Non-string entries are filtered rather than passed through as `unknown`.
  const mixedDays = asCondition({
    days: ["mon", 3, null, "fri"],
    startTime: "09:00",
    endTime: "17:00",
  });
  assert(
    "days" in mixedDays && mixedDays.days.length === 2 && mixedDays.days[1] === "fri",
    "non-string days are filtered out",
  );

  // Anything unrecognised degrades to the inert default rather than throwing —
  // one malformed row must not take down the whole rules list.
  for (const junk of [null, undefined, 42, "latest", [], { days: "mon" }, {}]) {
    const fallback = asCondition(junk);
    assert(
      "window" in fallback && fallback.window === "latest",
      `unrecognised condition ${JSON.stringify(junk)} falls back to latest`,
    );
  }
}

function testAsAction(): void {
  for (const type of ["notify", "review", "trace_only"] as const) {
    const action = asAction({ type, target: "Operations" });
    assert(action.type === type, `${type} survives`);
    assert(action.target === "Operations", "the target survives");
  }

  const defaulted = asAction({ type: "escalate", target: "Ops" });
  assert(defaulted.type === "trace_only", "an unknown action type defaults to trace_only");
  assert(defaulted.target === "Operations", "the default action targets Operations");

  const missingTarget = asAction({ type: "notify" });
  assert(
    missingTarget.type === "trace_only",
    "a notify action with no target is not a valid notify",
  );

  const nonStringTarget = asAction({ type: "notify", target: 5 });
  assert(nonStringTarget.type === "trace_only", "a non-string target is rejected");

  for (const junk of [null, undefined, "notify", 1, []]) {
    assert(asAction(junk).type === "trace_only", "junk defaults to trace_only");
  }
}

function testAsTrace(): void {
  const trace = asTrace({ assetId: "asset-1" });
  assert(trace !== null && trace.assetId === "asset-1", "a record passes through");
  for (const junk of [null, undefined, 1, "x"]) {
    assert(asTrace(junk) === null, `${JSON.stringify(junk)} is not a trace`);
  }
  // This is where `isRecord`'s `Array.isArray` guard is actually load-bearing:
  // `typeof [] === "object"`, so without the guard an array would pass through
  // as a trace. Dropping the guard makes exactly this assertion fail.
  assert(asTrace([1, 2]) === null, "an array is not a record, despite its typeof");
}

function testMapRuleRow(): void {
  const item = mapRuleRow(ruleRow());
  assert(item.id === "rule-1", "the id survives");
  assert(item.assetCode === "ASSET-1", "the joined asset code survives");

  // Dates cross the wire as ISO strings, and nullable dates stay null rather
  // than becoming the epoch.
  assert(item.createdAt === CREATED.toISOString(), "createdAt is ISO");
  assert(item.updatedAt === UPDATED.toISOString(), "updatedAt is ISO");
  assert(item.lastEvaluatedAt === null, "an unevaluated rule reports null, not a date");
  assert(item.publishedAt === null, "a null publishedAt stays null");

  const evaluated = mapRuleRow(ruleRow({ lastEvaluatedAt: UPDATED, publishedAt: CREATED }));
  assert(evaluated.lastEvaluatedAt === UPDATED.toISOString(), "lastEvaluatedAt is ISO");
  assert(evaluated.publishedAt === CREATED.toISOString(), "publishedAt is ISO");

  // The jsonb columns are narrowed on the way out, not handed over raw.
  assert(item.action.type === "notify", "the action is narrowed");
  const malformed = mapRuleRow(ruleRow({ action: { type: "escalate" } }));
  assert(
    malformed.action.type === "trace_only",
    "a malformed stored action still maps to a valid response",
  );
}

function testRuleBodyFromRow(): void {
  const body = ruleBodyFromRow(ruleRow());
  assert(body.code === "RULE-1", "the code round-trips");
  assert(body.thresholdValue === 100, "the threshold round-trips");

  // The jsonb columns are narrowed on the way into the body, not passed raw —
  // a draft body is what re-validation runs against.
  assert(
    "window" in body.condition && body.condition.window === "latest",
    "the condition is narrowed",
  );
  assert(body.action.type === "notify", "the action is narrowed");

  const malformed = ruleBodyFromRow(ruleRow({ condition: { nonsense: true } }));
  assert(
    "window" in malformed.condition && malformed.condition.window === "latest",
    "a malformed stored condition still yields a re-validatable body",
  );
}

function testMergeRuleDraft(): void {
  const row = ruleRow();

  // An absent key keeps the stored value.
  const untouched = mergeRuleDraft(row, {});
  assert(untouched.description === "Trips above 100 kW", "an absent key keeps the value");
  assert(untouched.thresholdValue === 100, "an absent threshold keeps the value");
  assert(untouched.assetId === "asset-1", "an absent assetId keeps the value");

  // An explicit null CLEARS it. This is the distinction a plain spread loses,
  // and the reason the per-field checks exist.
  const cleared = mergeRuleDraft(row, {
    description: null,
    thresholdValue: null,
    assetId: null,
    pointKey: null,
    operator: null,
    severity: null,
  });
  assert(cleared.description === null, "an explicit null clears the description");
  assert(cleared.thresholdValue === null, "an explicit null clears the threshold");
  assert(cleared.assetId === null, "an explicit null clears the asset");
  assert(cleared.pointKey === null, "an explicit null clears the point key");
  assert(cleared.operator === null, "an explicit null clears the operator");
  assert(cleared.severity === null, "an explicit null clears the severity");

  // A supplied value wins.
  const updated = mergeRuleDraft(row, { name: "Renamed", thresholdValue: 250 });
  assert(updated.name === "Renamed", "a supplied name wins");
  assert(updated.thresholdValue === 250, "a supplied threshold wins");
  assert(updated.code === "RULE-1", "an untouched field is preserved alongside");

  // Zero and empty string are values, not absences — a truthiness check here
  // would silently restore the stored value instead of applying the update.
  const zeroed = mergeRuleDraft(row, { thresholdValue: 0 });
  assert(zeroed.thresholdValue === 0, "zero is an update, not an absence");
}

/** Assertions for the pure row/DTO mapping layer (ADR 0014, §4.6). */
export function runRuleMappingTests(): void {
  testAsCondition();
  testAsAction();
  testAsTrace();
  testMapRuleRow();
  testRuleBodyFromRow();
  testMergeRuleDraft();
}
