import {
  asAction,
  asCondition,
  asTrace,
  mapRuleRow,
  mergeRuleDraft,
  ruleBodyFromRow,
} from "./rule-mapping";
import { ruleDraftBodySchema } from "./rules.schema";
import type { RuleRow } from "./rules.types";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const CREATED = new Date("2026-01-01T10:00:00.000Z");
const UPDATED = new Date("2026-02-02T11:30:00.000Z");

/**
 * Exported so `rules.service.spec.ts` can compose the real `mergeRuleDraft`
 * with the real `validateRuleDraft` (`F4.46`) over the same row shape, rather
 * than restating a second fixture that could drift from this one.
 */
export function ruleRow(overrides: Partial<RuleRow> = {}): RuleRow {
  return {
    id: "rule-1",
    code: "RULE-1",
    name: "Feeder overload",
    description: "Trips above 100 kW",
    // ADR 0031's two axes on one row: the concern is `safety`, the plant domain
    // is `electrical` and lives on the asset. This fixture used to carry
    // `category: "electrical"` — a row the database can no longer hold, since
    // `automation_rules_category_fk` (migration 0029) rejects it — `electrical` is not
    // a row in `bms.rule_categories`.
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
    // `F3.10`. Non-null on purpose, so the "an absent key keeps the value"
    // cases below can tell a preserved value from a substituted default — the
    // distinction `F4.46` lost on severity. The null direction is covered by
    // its own overridden fixtures.
    clearHoldSeconds: 300,
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

  // `F3.10` — the hold reaches the response as the stored number, and a row
  // that has none reports `null` rather than the consumer's 120 s default.
  assert(item.clearHoldSeconds === 300, "the stored clear hold reaches the response");
  assert(
    mapRuleRow(ruleRow({ clearHoldSeconds: null })).clearHoldSeconds === null,
    "a rule with no clear hold reports null, not the default",
  );

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
  assert(body.clearHoldSeconds === 300, "the clear hold round-trips");

  // `F3.10` / D16 — the body is what `mergeRuleDraft` folds a PATCH over, so a
  // stored null must arrive as `null` and not as an absent key: an absent key
  // would be indistinguishable from "leave it alone" one call later.
  const noHold = ruleBodyFromRow(ruleRow({ clearHoldSeconds: null }));
  assert(
    noHold.clearHoldSeconds === null,
    `a null clear hold round-trips as null, got ${String(noHold.clearHoldSeconds)}`,
  );

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
  assert(untouched.severity === "warning", "an absent severity keeps the value");
  assert(untouched.clearHoldSeconds === 300, "an absent clear hold keeps the value");

  // `F4.46`. The three checks above all run over a row whose severity is
  // `"warning"`, so neither direction of the defect could show here: the value
  // being preserved was also the value being substituted downstream. A stored
  // **null** is the case that mattered, and it has to survive an update that
  // simply does not mention severity — which is every update the builder sends
  // for a rule that has none.
  const noSeverity = mergeRuleDraft(ruleRow({ severity: null }), {});
  assert(
    noSeverity.severity === null,
    `an absent severity over a null row must stay null, got ${String(noSeverity.severity)}`,
  );

  // `F3.10` / D16 — the same trap at the same door, one column over. `null`
  // means "the 120 s default", so a merge that quietly turned it into `120`
  // would freeze today's default into the row and make a later change to
  // `DEFAULT_CLEAR_HOLD_SECONDS` skip every rule ever saved.
  const noHold = mergeRuleDraft(ruleRow({ clearHoldSeconds: null }), {});
  assert(
    noHold.clearHoldSeconds === null,
    `an absent clear hold over a null row must stay null, got ${String(noHold.clearHoldSeconds)}`,
  );

  // An explicit null CLEARS it. This is the distinction a plain spread loses,
  // and the reason the per-field checks exist.
  const cleared = mergeRuleDraft(row, {
    description: null,
    thresholdValue: null,
    assetId: null,
    pointKey: null,
    operator: null,
    severity: null,
    clearHoldSeconds: null,
  });
  assert(cleared.description === null, "an explicit null clears the description");
  assert(cleared.thresholdValue === null, "an explicit null clears the threshold");
  assert(cleared.assetId === null, "an explicit null clears the asset");
  assert(cleared.pointKey === null, "an explicit null clears the point key");
  assert(cleared.operator === null, "an explicit null clears the operator");
  assert(cleared.severity === null, "an explicit null clears the severity");
  assert(cleared.clearHoldSeconds === null, "an explicit null clears the clear hold");

  // A supplied value wins.
  const updated = mergeRuleDraft(row, {
    name: "Renamed",
    thresholdValue: 250,
    clearHoldSeconds: 45,
  });
  assert(updated.name === "Renamed", "a supplied name wins");
  assert(updated.thresholdValue === 250, "a supplied threshold wins");
  assert(updated.clearHoldSeconds === 45, "a supplied clear hold wins");
  assert(updated.code === "RULE-1", "an untouched field is preserved alongside");

  // Zero and empty string are values, not absences — a truthiness check here
  // would silently restore the stored value instead of applying the update.
  const zeroed = mergeRuleDraft(row, { thresholdValue: 0 });
  assert(zeroed.thresholdValue === 0, "zero is an update, not an absence");
}

/**
 * `F3.10` ruling Q2 — the bound on `clearHoldSeconds`, asserted here because
 * `ruleDraftBodySchema` has no behavioural spec of its own today: the OpenAPI
 * ledger walks its *shape* and nothing exercises its parsing.
 *
 * `ruleUpdateBodySchema` and `rulePreviewBodySchema` are derived from this
 * schema (`.partial().extend(...)` and `.extend(...)`), so they inherit the
 * field and its bound; restating the matrix over all three would assert Zod's
 * own derivation rather than this rule.
 */
function testClearHoldSecondsSchema(): void {
  const draft = (clearHoldSeconds?: unknown): Record<string, unknown> => ({
    name: "Feeder overload",
    ruleType: "threshold",
    assetId: "11111111-1111-1111-1111-111111111111",
    pointKey: "kw",
    operator: "gt",
    thresholdValue: 100,
    condition: { window: "latest" },
    action: { type: "notify", target: "Operations" },
    ...(clearHoldSeconds === undefined ? {} : { clearHoldSeconds }),
  });

  const parse = (value?: unknown) => ruleDraftBodySchema.safeParse(draft(value));

  // A form posts strings; `z.coerce` is what spares the SPA a parseInt.
  const coerced = parse("45");
  assert(
    coerced.success && coerced.data.clearHoldSeconds === 45,
    "a numeric string clear hold coerces to a number",
  );

  assert(parse(1).success, "one second is the lower bound, inclusive");
  assert(parse(86_400).success, "twenty-four hours is the upper bound, inclusive");

  // `0` would make "hold" meaningless — an alarm would clear on the first
  // non-matching sample, which is the debounce this column exists to prevent.
  assert(!parse(0).success, "zero seconds is refused");
  assert(!parse(-1).success, "a negative clear hold is refused");
  assert(!parse(86_401).success, "more than twenty-four hours is refused");
  // The column is `integer`; without `.int()` a fractional value would reach
  // Postgres and be rounded there rather than refused here.
  assert(!parse(1.5).success, "a fractional clear hold is refused");

  // Both spellings of "the default": absent on a create, explicit `null` on a
  // clear. Neither is turned into a number on this path (D16).
  const omitted = parse();
  assert(
    omitted.success && omitted.data.clearHoldSeconds === undefined,
    "an omitted clear hold stays absent",
  );
  const explicitNull = parse(null);
  assert(
    explicitNull.success && explicitNull.data.clearHoldSeconds === null,
    "an explicit null clear hold is accepted and stays null",
  );
}

/** Assertions for the pure row/DTO mapping layer (ADR 0014, §4.6). */
export function runRuleMappingTests(): void {
  testAsCondition();
  testAsAction();
  testAsTrace();
  testMapRuleRow();
  testRuleBodyFromRow();
  testMergeRuleDraft();
  testClearHoldSecondsSchema();
}
