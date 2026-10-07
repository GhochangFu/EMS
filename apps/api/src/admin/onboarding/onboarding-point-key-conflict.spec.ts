import {
  conflictingPointKeyDeclaration,
  pointKeyConflictMessage,
  pointKeyDeclarationProblems,
  type CatalogPointKey,
  type CatalogPointKeyFields,
} from "./onboarding-point-key-conflict";

/**
 * ADR 0051 Amendment 1 — the pure half of the onboarding point-key guard.
 *
 * Assertions live here and the `.test.ts` sibling is the Vitest entry point
 * (ADR 0014). This file needs no database and no stack, which is the point: the
 * integration suite that proves the wiring self-skips without `DATABASE_URL`,
 * so it is this spec that holds the rule on a developer machine.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const CATALOG: CatalogPointKey = { domain: "electrical", unit: "kW" };
const UNSET: CatalogPointKey = { domain: null, unit: null };

function reusesRow(declared: Parameters<typeof conflictingPointKeyDeclaration>[0]): boolean {
  return conflictingPointKeyDeclaration(declared, CATALOG) === null;
}

export function runOnboardingPointKeyConflictTests(): void {
  // ── A draft that asserts nothing contradicts nothing ────────────────────
  assert(reusesRow({}), "a draft declaring neither field reuses the catalog row");
  assert(
    reusesRow({ unit: undefined, domain: undefined }),
    "explicit undefined is the same as absent",
  );
  assert(reusesRow({ unit: "", domain: "   " }), "an empty or blank declaration states nothing");
  assert(reusesRow({ unit: "kW", domain: "electrical" }), "an exact agreement reuses the row");
  assert(reusesRow({ unit: " kW " }), "the declared value is trimmed before comparison");

  // ── unit is compared exactly, because a unit is a symbol ────────────────
  const wrongUnit = conflictingPointKeyDeclaration({ unit: "MW" }, CATALOG);
  assert(wrongUnit?.field === "unit", "a different unit is a conflict on unit");
  assert(wrongUnit?.declared === "MW", "the conflict reports what the draft declared");
  assert(wrongUnit?.existing === "kW", "the conflict reports what the catalog holds");

  assert(
    conflictingPointKeyDeclaration({ unit: "kw" }, CATALOG)?.field === "unit",
    "unit is case-sensitive — kW and kw are different symbols",
  );

  // ── An unset catalog field is a conflict, not a gap the draft may fill ──
  const fillsNull = conflictingPointKeyDeclaration({ unit: "%" }, UNSET);
  assert(fillsNull?.field === "unit", "declaring a unit the catalog leaves unset is a conflict");
  assert(fillsNull?.existing === null, "the conflict reports the catalog value as unset");
  assert(
    conflictingPointKeyDeclaration({ domain: "environment" }, UNSET)?.field === "domain",
    "declaring a domain the catalog leaves unset is a conflict",
  );

  // ── domain is normalised, because the column is an unconstrained string ─
  assert(reusesRow({ domain: "Electrical" }), "domain is compared case-folded");
  assert(reusesRow({ domain: " ELECTRICAL " }), "domain is trimmed as well as case-folded");
  const wrongDomain = conflictingPointKeyDeclaration({ domain: "hvac" }, CATALOG);
  assert(wrongDomain?.field === "domain", "a genuinely different domain is a conflict");
  assert(wrongDomain?.existing === "electrical", "the domain conflict reports the catalog value");

  // ── unit is reported first, because it is the field that reaches telemetry
  assert(
    conflictingPointKeyDeclaration({ unit: "MW", domain: "hvac" }, CATALOG)?.field === "unit",
    "when both fields disagree the unit is the one reported",
  );

  // ── The message names the code, both values and the way out ─────────────
  const catalogMessage = pointKeyConflictMessage("kw", wrongUnit!, "catalog");
  assert(catalogMessage.includes("'kw'"), "the message names the code");
  assert(catalogMessage.includes("'MW'"), "the message names the declared value");
  assert(catalogMessage.includes("unit 'kW'"), "the message names the catalog value");
  assert(
    catalogMessage.includes("global administrator"),
    "the message names who can reconcile the catalog entry",
  );

  const unsetMessage = pointKeyConflictMessage("battery_charge_pct", fillsNull!, "catalog");
  assert(
    unsetMessage.includes("no unit"),
    "an unset catalog value reads as 'no unit', not as 'unit null'",
  );

  const draftMessage = pointKeyConflictMessage("kw", wrongUnit!, "draft");
  assert(
    draftMessage.includes("twice"),
    "a code declared twice in one draft says so, rather than blaming the catalog",
  );
  assert(
    !draftMessage.includes("global administrator"),
    "the in-draft case is fixed by the author, not by a global administrator",
  );
}

// ── F4.225 — the commit walk, without the writes ─────────────────────────
// One exported claim per `it()`: `assert` throws, so a claim that shared a
// runner with another would hide behind the first one to fail.

const FIELDS: CatalogPointKeyFields = new Map([["kw", { unit: "kW", domain: "electrical" }]]);

/** P1 — a declaration that contradicts the catalog row is the commit's catalog sentence. */
export function assertP1ACatalogContradictionIsTheCatalogSentence(): void {
  const problems = pointKeyDeclarationProblems([{ code: "kw", unit: "MW" }], FIELDS);
  const expected = pointKeyConflictMessage("kw", { field: "unit", declared: "MW", existing: "kW" }, "catalog");
  assert(problems.length === 1 && problems[0].message === expected, `P1 the catalog sentence, got ${JSON.stringify(problems)}`);
}

/** P2 — a declaration that states nothing reuses the catalog row. */
export function assertP2ADeclarationThatStatesNothingHasNoProblem(): void {
  const problems = pointKeyDeclarationProblems([{ code: "kw" }], FIELDS);
  assert(problems.length === 0, `P2 no problem, got ${JSON.stringify(problems)}`);
}

/** P3 — a code new to the catalog declared twice with two units is the draft sentence, at the second index. */
export function assertP3ATwiceDeclaredNewCodeIsTheDraftSentence(): void {
  const problems = pointKeyDeclarationProblems([{ code: "flow", unit: "m3/h" }, { code: "flow", unit: "L/s" }], new Map());
  const expected = pointKeyConflictMessage("flow", { field: "unit", declared: "L/s", existing: "m3/h" }, "draft");
  assert(
    problems.length === 1 && problems[0].index === 1 && problems[0].message === expected,
    `P3 the draft sentence at index 1, got ${JSON.stringify(problems)}`,
  );
}

/** P4 — the problem carries the index of the declaration, not of the first key. */
export function assertP4TheProblemCarriesItsIndex(): void {
  const problems = pointKeyDeclarationProblems([{ code: "ok" }, { code: "kw", unit: "MW" }], FIELDS);
  assert(problems.length === 1 && problems[0].index === 1, `P4 one problem at index 1, got ${JSON.stringify(problems)}`);
}

/** P5 — the problem names the field that disagreed. */
export function assertP5TheProblemNamesTheDomainField(): void {
  const problems = pointKeyDeclarationProblems([{ code: "kw", domain: "hvac" }], FIELDS);
  assert(problems.length === 1 && problems[0].field === "domain", `P5 a domain problem, got ${JSON.stringify(problems)}`);
}

/** P6 — a duplicate that agrees is tolerated, as the commit tolerates it. */
export function assertP6AnAgreeingDuplicateIsTolerated(): void {
  const problems = pointKeyDeclarationProblems([{ code: "kw", unit: "kW" }, { code: "kw", unit: "kW" }], FIELDS);
  assert(problems.length === 0, `P6 no problem, got ${JSON.stringify(problems)}`);
}

/**
 * P7 — after a catalog contradiction, a later duplicate that agrees with the
 * first declaration is compared with the catalog again: it gets the catalog
 * sentence, not a "declared twice" sentence about a unit the draft never stated.
 */
export function assertP7ADuplicateAfterACatalogClashIsTheCatalogSentence(): void {
  const problems = pointKeyDeclarationProblems([{ code: "kw", unit: "MW" }, { code: "kw", unit: "MW" }], FIELDS);
  const expected = pointKeyConflictMessage("kw", { field: "unit", declared: "MW", existing: "kW" }, "catalog");
  const second = problems.find((problem) => problem.index === 1);
  assert(
    second !== undefined && second.message === expected,
    `P7 the catalog sentence at index 1, got ${JSON.stringify(problems)}`,
  );
}
