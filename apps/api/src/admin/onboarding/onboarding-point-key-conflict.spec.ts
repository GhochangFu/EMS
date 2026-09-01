import {
  conflictingPointKeyDeclaration,
  pointKeyConflictMessage,
  type CatalogPointKey,
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
