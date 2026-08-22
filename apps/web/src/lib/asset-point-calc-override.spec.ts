import type { AssetPointCalcConfigDto } from "@bms/shared";

import {
  calcFieldRows,
  canClear,
  canSubmit,
  columnOrigin,
  draftFromConfig,
  draftProblems,
  draftToBody,
  hasAnyOverride,
  EMPTY_DRAFT,
} from "./asset-point-calc-override";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const NOTHING = {
  formula: null,
  formulaDialect: null,
  calcTrigger: null,
  calcIntervalSeconds: null,
  maxInputAgeSeconds: null,
} as const;

const SCHEDULED_TEMPLATE = {
  formula: "{KW} * 2",
  formulaDialect: "bms-calc-v1",
  calcTrigger: "scheduled",
  calcIntervalSeconds: 300,
  maxInputAgeSeconds: 600,
} as const;

function config(
  override: Partial<AssetPointCalcConfigDto["override"]> = {},
  template: AssetPointCalcConfigDto["template"] = { ...SCHEDULED_TEMPLATE },
): AssetPointCalcConfigDto {
  const ov = { ...NOTHING, ...override };
  return {
    pointKey: "KWH",
    templatePointId: "tp-1",
    label: "Energy",
    unit: "kWh",
    assetPointId: null,
    template,
    override: ov,
    effective: {
      formula: ov.formula ?? template.formula,
      formulaDialect: ov.formulaDialect ?? template.formulaDialect,
      calcTrigger: ov.calcTrigger ?? template.calcTrigger,
      calcIntervalSeconds: ov.calcIntervalSeconds ?? template.calcIntervalSeconds,
      maxInputAgeSeconds: ov.maxInputAgeSeconds ?? template.maxInputAgeSeconds,
    },
  };
}

/** Overridden, inherited and unset are three states, not two. */
export function runColumnOriginTests(): void {
  const partial = config({ calcIntervalSeconds: 45 });

  assert(
    columnOrigin(partial, "calcIntervalSeconds") === "overridden",
    "a set override column reads as overridden",
  );
  assert(
    columnOrigin(partial, "formula") === "inherited",
    "a null override with a template value reads as inherited, not as empty",
  );

  const empty = config({}, { ...NOTHING });
  assert(
    columnOrigin(empty, "formula") === "unset",
    "a null override with no template value is unset — telling that apart from inherited " +
      "is the difference between 'the template decides' and 'nothing decides'",
  );
}

/** Clear is disabled when there is nothing to clear. */
export function runClearAvailabilityTests(): void {
  assert(!hasAnyOverride(config()), "an all-null override is no override");
  assert(
    !canClear(config()),
    "Clear must be disabled with nothing overridden — the API returns 404, and an error " +
      "that says nothing went wrong is the worst kind",
  );
  assert(canClear(config({ maxInputAgeSeconds: 30 })), "one overridden column is enough to clear");
}

/** The rows carry all three values, not just what runs. */
export function runFieldRowTests(): void {
  const rows = calcFieldRows(config({ calcIntervalSeconds: 45 }));

  assert(rows.length === 5, `all five columns must be listed, got ${rows.length}`);
  const interval = rows.find((row) => row.field === "calcIntervalSeconds");
  assert(
    interval?.templateValue === "300s" && interval?.effectiveValue === "45s",
    `both the template's value and what runs must show — got ${String(
      interval?.templateValue,
    )} / ${String(interval?.effectiveValue)}. "45s" alone says what runs but not whether ` +
      "changing the template would change it, which is the question this page answers",
  );
  assert(interval?.origin === "overridden", "and the row must say which it is");

  const formula = rows.find((row) => row.field === "formula");
  assert(
    formula?.effectiveValue === "{KW} * 2" && formula?.origin === "inherited",
    "an un-overridden column shows the template's value as what runs",
  );

  const unsetRows = calcFieldRows(config({}, { ...NOTHING }));
  assert(
    unsetRows.every((row) => row.templateValue === "—"),
    "an unset value renders as a dash, not as 'null'",
  );
}

/** The form seeds from the existing override, so editing is not retyping. */
export function runDraftSeedingTests(): void {
  const draft = draftFromConfig(config({ calcIntervalSeconds: 45, formula: "{KW} * 9" }));

  assert(draft.calcIntervalSeconds === "45", `expected "45", got ${draft.calcIntervalSeconds}`);
  assert(draft.formula === "{KW} * 9", "the overridden formula must seed the field");
  assert(
    draft.calcTrigger === "",
    "an inherited column must seed EMPTY, not with the template's value — seeding it would " +
      "silently convert an inherited column into an override on the next save",
  );

  const none = draftFromConfig(config());
  assert(
    none.formula === "" && none.calcIntervalSeconds === "" && none.maxInputAgeSeconds === "",
    "nothing overridden seeds an empty form",
  );
}

/** Empty means inherit; the dialect is sent only with a formula. */
export function runDraftToBodyTests(): void {
  const blank = draftToBody(EMPTY_DRAFT);
  assert(
    Object.values(blank).every((value) => value === null),
    "an empty form is five nulls — every column inherits",
  );

  const withFormula = draftToBody({ ...EMPTY_DRAFT, formula: "  {KW} + 1  " });
  assert(withFormula.formula === "{KW} + 1", "the formula is trimmed");
  assert(
    withFormula.formulaDialect === "bms-calc-v1",
    "the dialect rides along with a formula — there is one dialect, and asking an author to " +
      "restate it on every edit is the restatement decision 6 exists to avoid",
  );

  const withoutFormula = draftToBody({ ...EMPTY_DRAFT, calcIntervalSeconds: "45" });
  assert(
    withoutFormula.formulaDialect === null,
    "and it is NOT sent without one — that would override the dialect on a point whose " +
      "formula is still the template's",
  );
  assert(withoutFormula.calcIntervalSeconds === 45, "numbers are parsed, not sent as strings");
}

/**
 * **D-1, before the request rather than after the 400.**
 *
 * `null` meaning inherit makes this the structural mistake, not a careless one:
 * changing the trigger and leaving the interval alone is the obvious thing to
 * do, and the merged result is a counted skip.
 */
export function runD1IsCaughtBeforeSubmitTests(): void {
  const target = config();

  const triggerOnly = draftProblems({ ...EMPTY_DRAFT, calcTrigger: "streaming" }, target);
  assert(triggerOnly.length > 0, "streaming over a scheduled template must be refused");
  assert(
    triggerOnly.join(" ").includes("300s"),
    `the message must name the inherited interval, got: ${triggerOnly.join(" ")}`,
  );
  assert(
    triggerOnly.join(" ").includes("cannot clear an inherited value"),
    "and must say the override is impossible rather than suggesting a fix that cannot work",
  );
  assert(!canSubmit({ ...EMPTY_DRAFT, calcTrigger: "streaming" }, target), "Save must be disabled");

  const streamingTemplate = config({}, { ...SCHEDULED_TEMPLATE, calcTrigger: "streaming", calcIntervalSeconds: null });
  const scheduledNoInterval = draftProblems({ ...EMPTY_DRAFT, calcTrigger: "scheduled" }, streamingTemplate);
  assert(scheduledNoInterval.length > 0, "scheduled with no interval must be refused");
  assert(
    scheduledNoInterval.join(" ").includes("needs an interval"),
    `the message must name what is missing, got: ${scheduledNoInterval.join(" ")}`,
  );

  const both = { ...EMPTY_DRAFT, calcTrigger: "scheduled", calcIntervalSeconds: "60" };
  assert(
    canSubmit(both, streamingTemplate),
    `overriding both together must be allowed, got: ${draftProblems(both, streamingTemplate).join(" ")}`,
  );
}

/** The shared bounds are applied here too, so the 400 is the backstop. */
export function runBoundsTests(): void {
  const target = config();

  assert(
    draftProblems({ ...EMPTY_DRAFT, calcIntervalSeconds: "5" }, target).length > 0,
    "an interval below the shared minimum must be caught",
  );
  assert(
    draftProblems({ ...EMPTY_DRAFT, calcIntervalSeconds: "90000" }, target).length > 0,
    "and above the maximum",
  );
  assert(
    draftProblems({ ...EMPTY_DRAFT, calcIntervalSeconds: "45" }, target).length === 0,
    "a legal interval passes",
  );
  assert(
    draftProblems({ ...EMPTY_DRAFT, maxInputAgeSeconds: "0" }, target).length > 0,
    "the input validity window is bounded at 1",
  );
  assert(
    draftProblems({ ...EMPTY_DRAFT, calcIntervalSeconds: "45.5" }, target).length > 0,
    "a fractional interval is not a whole number of seconds",
  );
}

/** An empty form is Clear, not Save — the same rule the API applies. */
export function runEmptySubmitIsRefusedTests(): void {
  const problems = draftProblems(EMPTY_DRAFT, config());
  assert(problems.length > 0, "an all-empty form must not be submittable");
  assert(
    problems.join(" ").includes("Clear"),
    `and must point at Clear rather than reading as an error, got: ${problems.join(" ")}`,
  );
}
