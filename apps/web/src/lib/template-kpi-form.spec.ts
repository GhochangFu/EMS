/**
 * The KPIs tab's form rules (`F2.5`, ADR 0038 decision 9 — Unit 9d).
 */
import { CALC_DIALECT, MAX_FORMULA_POINT_REFS } from "@bms/shared";
import type { TemplateKpi } from "@bms/shared";

import {
  MAX_KPI_ENTRIES,
  MAX_KPI_POINT_KEYS,
  blankKpiRow,
  buildKpiPayload,
  effectivePointKeys,
  kpiFormErrors,
  kpiRowsFrom,
  kpisHaveChanged,
  validateKpiRow,
  type TemplateKpiRow,
} from "./template-kpi-form";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const DECLARED = ["CHW_SUPPLY_T", "CHW_RETURN_T", "FLOW"];

function row(overrides: Partial<TemplateKpiRow> = {}): TemplateKpiRow {
  return {
    code: "DELTA_T",
    name: "Delta T",
    unit: "degC",
    pointKeys: ["CHW_SUPPLY_T", "CHW_RETURN_T"],
    expression: "{CHW_RETURN_T} - {CHW_SUPPLY_T}",
    dialect: "unvalidated",
    higherIsBetter: null,
    ...overrides,
  };
}

/**
 * **The trap this module exists for.**
 *
 * `templateKpiSchema` is `.strict()` and both optional fields reject `null` —
 * `unit: z.string().max(32).optional()`, `higherIsBetter: z.boolean().optional()`.
 * Every other payload builder on this branch maps an emptied box to `null`,
 * which here is a 400 on every KPI whose unit the author cleared.
 */
export function runOptionalKeysAreOmittedTests(): void {
  const [full] = buildKpiPayload([row({ unit: "degC", higherIsBetter: true })]);
  assert(full.unit === "degC", "a set unit is sent");
  assert(full.higherIsBetter === true, "a set direction is sent");

  const [bare] = buildKpiPayload([row({ unit: "", higherIsBetter: null })]);
  // Asserted with `in`, not `=== undefined`. A key that is *present* and
  // explicitly `undefined` passes an `undefined` check, and `JSON.stringify`
  // then drops it — so the wire would be right by accident while the assertion
  // proved nothing about the object.
  assert(!("unit" in bare), `an empty unit must be absent, not null — got ${JSON.stringify(bare)}`);
  assert(
    !("higherIsBetter" in bare),
    `an unset direction must be absent, not null — got ${JSON.stringify(bare)}`,
  );

  // `false` is a value, not an absence: "lower is better" is a declared
  // direction and must survive.
  const [lower] = buildKpiPayload([row({ higherIsBetter: false })]);
  assert("higherIsBetter" in lower, "false is a declared direction and must be sent");
  assert(lower.higherIsBetter === false, "…as false, not dropped");

  // A whitespace unit is an absence too.
  const [padded] = buildKpiPayload([row({ unit: "   " })]);
  assert(!("unit" in padded), "a whitespace unit is absent");
}

/** Seeding, and what a new KPI starts as. */
export function runSeedTests(): void {
  const stored: TemplateKpi[] = [
    { code: "A", name: "A", pointKeys: ["FLOW"], expression: "{FLOW}", dialect: "unvalidated" },
  ];
  const [seeded] = kpiRowsFrom(stored);
  assert(seeded.unit === "", "an absent unit seeds as empty text, not undefined");
  assert(
    seeded.higherIsBetter === null,
    `an absent direction seeds as null, not false — got ${seeded.higherIsBetter}`,
  );
  assert(seeded.dialect === "unvalidated", "the stored dialect is kept");
  assert(kpiRowsFrom(undefined).length === 0, "a template with no kpis section seeds no rows");

  // The array is copied. A row that shared the stored array would let an edit
  // reach through into the query cache.
  seeded.pointKeys.push("X");
  assert(stored[0].pointKeys.length === 1, "pointKeys is copied, not shared with the stored object");

  const fresh = blankKpiRow();
  assert(
    fresh.dialect === "unvalidated",
    "a new KPI starts unvalidated — decision 9 makes the button the only way up",
  );
  assert(fresh.higherIsBetter === null, "…with no direction declared");
}

/**
 * `pointKeys` is derived once validated, manual before.
 *
 * The schema demands exact two-way correspondence under `bms-calc-v1`. A
 * hand-maintained array cannot survive an expression edit, and the author's
 * only feedback would be a Zod path on a field they never touched.
 */
export function runPointKeyDerivationTests(): void {
  const manual = row({ dialect: "unvalidated", pointKeys: ["ANYTHING"] });
  assert(
    effectivePointKeys(manual).join(",") === "ANYTHING",
    "an unvalidated KPI keeps its manual list — its expression need not parse",
  );

  const validated = row({ dialect: CALC_DIALECT, pointKeys: ["STALE"] });
  assert(
    effectivePointKeys(validated).join(",") === "CHW_RETURN_T,CHW_SUPPLY_T",
    `a validated KPI derives from its expression — got ${effectivePointKeys(validated).join(",")}`,
  );

  // The point of deriving: the stored array is ignored, so it cannot go stale.
  assert(
    !effectivePointKeys(validated).includes("STALE"),
    "a stale stored array does not survive into the payload",
  );

  // Recomputed on every edit, not only when Validate is pressed.
  const edited = { ...validated, expression: "{FLOW} * 2" };
  assert(
    effectivePointKeys(edited).join(",") === "FLOW",
    "editing a validated expression recomputes the keys immediately",
  );

  // An unparseable expression yields nothing rather than a partial list.
  const broken = { ...validated, expression: "{{{" };
  assert(effectivePointKeys(broken).length === 0, "an unparseable expression derives no keys");

  const [sent] = buildKpiPayload([validated]);
  assert(
    sent.pointKeys.join(",") === "CHW_RETURN_T,CHW_SUPPLY_T",
    "the payload carries the derived keys",
  );
}

/**
 * Decision 9's atomicity.
 *
 * On failure `upgradeKpiToCalcDialect` returns the input reference, so nothing
 * new is written — not the dialect, not the expression.
 */
export function runValidateActionTests(): void {
  const good = validateKpiRow(row(), DECLARED);
  assert(good.validation.state === "ok", "a valid expression validates");
  assert(good.row.dialect === CALC_DIALECT, "the dialect flips on success");
  assert(
    good.row.pointKeys.join(",") === "CHW_RETURN_T,CHW_SUPPLY_T",
    `the derived keys are written on success — got ${good.row.pointKeys.join(",")}`,
  );

  const unparseable = validateKpiRow(row({ expression: "{CHW_SUPPLY_T} +" }), DECLARED);
  assert(unparseable.validation.state === "error", "an unparseable expression fails");
  assert(
    unparseable.row.dialect === "unvalidated",
    `the dialect must not flip on failure — got ${unparseable.row.dialect}`,
  );

  // The reference the expression names is not a point this template declares.
  const unknown = validateKpiRow(row({ expression: "{NOT_A_POINT}" }), DECLARED);
  assert(unknown.validation.state === "error", "an unknown reference fails");
  assert(unknown.row.dialect === "unvalidated", "…and the dialect stays put");

  // An empty expression cannot be validated into existence.
  const empty = validateKpiRow(row({ expression: "" }), DECLARED);
  assert(empty.validation.state === "error", "an empty expression fails");
  assert(empty.row.dialect === "unvalidated", "…and the dialect stays put");

  // Validating an already-validated row is idempotent.
  const again = validateKpiRow(good.row, DECLARED);
  assert(again.validation.state === "ok" && again.row.dialect === CALC_DIALECT, "revalidating is safe");
}

/** Codes, names, expressions and the section cap. */
export function runFormErrorTests(): void {
  assert(kpiFormErrors([row()], DECLARED).length === 0, "a valid KPI has no problems");

  const blank = kpiFormErrors([row({ code: "", name: "  ", expression: "" })], DECLARED);
  assert(blank.some((problem) => problem.field === "code"), "a blank code is refused");
  assert(blank.some((problem) => problem.field === "name"), "a blank name is refused");
  // Decision 9 protects a **stored** expression, and `.min(1)` means no stored
  // expression is ever empty — so an empty field is one just cleared.
  assert(
    blank.some((problem) => problem.field === "expression"),
    "an empty expression is refused even while unvalidated",
  );

  const duplicated = kpiFormErrors([row(), row({ name: "Other" })], DECLARED);
  assert(duplicated.length === 1, `one duplicate code is one problem — got ${duplicated.length}`);
  assert(duplicated[0].row === 1, "reported against the second occurrence");
  assert(
    duplicated[0].message.includes("KPI 1"),
    `the message names the KPI it collided with — got ${duplicated[0].message}`,
  );

  const tooLong = kpiFormErrors(
    [row({ code: "c".repeat(65), name: "n".repeat(256), unit: "u".repeat(33) })],
    DECLARED,
  );
  assert(tooLong.some((problem) => problem.field === "code"), "64 is the code cap");
  assert(tooLong.some((problem) => problem.field === "name"), "255 is the name cap");
  assert(tooLong.some((problem) => problem.field === "unit"), "32 is the unit cap");

  const atCap = kpiFormErrors(
    [row({ code: "c".repeat(64), name: "n".repeat(255), unit: "u".repeat(32) })],
    DECLARED,
  );
  assert(atCap.length === 0, `the caps are inclusive — got ${JSON.stringify(atCap)}`);

  const tooMany = kpiFormErrors(
    Array.from({ length: MAX_KPI_ENTRIES + 1 }, (_, index) => row({ code: `K${index}` })),
    DECLARED,
  );
  assert(
    tooMany.some((problem) => problem.row === null && problem.field === "kpis"),
    "the section cap is reported against the section, not a row",
  );
}

/**
 * A KPI may only read points the template declares.
 *
 * `assertContentRefsResolve` rejects the rest, with a path into `content`
 * rather than at the KPI. Removing a point on the Points tab is what causes it.
 */
export function runPointKeyResolutionTests(): void {
  const stale = kpiFormErrors([row({ pointKeys: ["GONE"], expression: "{GONE}" })], DECLARED);
  assert(stale.length === 1, `an undeclared key is one problem — got ${stale.length}`);
  assert(stale[0].field === "pointKeys", "reported against the keys");
  assert(
    stale[0].message.includes("GONE"),
    `the message names the key — got ${stale[0].message}`,
  );

  const none = kpiFormErrors([row({ pointKeys: [], expression: "1 + 1" })], DECLARED);
  assert(none.some((problem) => problem.field === "pointKeys"), "a KPI must read at least one point");

  // The message differs by dialect: an unvalidated KPI has a control to fill
  // in, a validated one has an expression that references nothing.
  const validatedNone = kpiFormErrors(
    [row({ dialect: CALC_DIALECT, expression: "1 + 1", pointKeys: [] })],
    DECLARED,
  );
  assert(
    validatedNone.some((problem) => problem.message.includes("references no points")),
    `a validated KPI is told its expression reads nothing — got ${JSON.stringify(validatedNone)}`,
  );

  assert(MAX_KPI_POINT_KEYS === MAX_FORMULA_POINT_REFS, "the cap is the shared constant");
  const overCap = kpiFormErrors(
    [row({ pointKeys: Array.from({ length: MAX_KPI_POINT_KEYS + 1 }, (_, i) => `K${i}`) })],
    Array.from({ length: MAX_KPI_POINT_KEYS + 1 }, (_, i) => `K${i}`),
  );
  assert(
    overCap.some((problem) => problem.field === "pointKeys"),
    "more than the cap is refused",
  );
}

/** A change is what would be sent. */
export function runChangeDetectionTests(): void {
  const stored: TemplateKpi[] = [
    {
      code: "DELTA_T",
      name: "Delta T",
      unit: "degC",
      pointKeys: ["CHW_SUPPLY_T", "CHW_RETURN_T"],
      expression: "{CHW_RETURN_T} - {CHW_SUPPLY_T}",
      dialect: "unvalidated",
    },
  ];
  const rows = kpiRowsFrom(stored);

  assert(!kpisHaveChanged(rows, stored), "an untouched form has no changes");
  assert(
    !kpisHaveChanged([{ ...rows[0], name: "Delta T " }], stored),
    "a trailing space is trimmed before sending, so it is not a change",
  );
  assert(kpisHaveChanged([{ ...rows[0], name: "ΔT" }], stored), "a real edit is a change");
  assert(kpisHaveChanged([], stored), "removing the last KPI is a change");
  assert(
    kpisHaveChanged([{ ...rows[0], dialect: CALC_DIALECT }], stored),
    "validating a KPI is a change worth saving",
  );
  assert(!kpisHaveChanged([], undefined), "no rows and no stored section is no change");
}
