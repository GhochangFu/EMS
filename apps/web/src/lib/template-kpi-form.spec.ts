/**
 * The KPIs tab's form rules (`F2.5`, ADR 0038 decision 9 — Unit 9d).
 */
import { CALC_DIALECT, CALC_DIALECT_V2, MAX_FORMULA_POINT_REFS } from "@bms/shared";
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
 * A stored `bms-calc-v2` KPI survives being read and sent back (`F2.9`, ADR
 * 0055 decision 2; the owner's Q3 ruling).
 *
 * The API accepts a `v2` KPI since the dialect widened. A tab that read one
 * back as `"unvalidated"` would not merely mislabel it on screen:
 * `buildKpiPayload` writes **every** row's dialect on save, so editing any
 * *other* KPI sends the untouched `v2` row back as unparsed. With
 * `pointKeys: []` — a KPI whose every reference is cross-asset, which is the
 * shape Q3b exists for — the server refuses the whole save naming a field the
 * tab gives no way to repair; with a non-empty `pointKeys` the save succeeds
 * and a parsed, cross-checked KPI silently becomes an unparsed one.
 */
export function runStoredV2KpiSurvivesTests(): void {
  const storedV2: TemplateKpi = {
    code: "PUE",
    name: "Power usage effectiveness",
    pointKeys: [],
    expression: "sum({kw} @site) / sum({kw} @group('IT_LOAD'))",
    dialect: CALC_DIALECT_V2,
  };
  const storedV1: TemplateKpi = {
    code: "DELTA_T",
    name: "Delta T",
    pointKeys: ["CHW_SUPPLY_T", "CHW_RETURN_T"],
    expression: "{CHW_RETURN_T} - {CHW_SUPPLY_T}",
    dialect: CALC_DIALECT,
  };

  const rows = kpiRowsFrom([storedV2, storedV1]);
  assert(
    rows[0].dialect === CALC_DIALECT_V2,
    `a stored v2 KPI must read back as v2, got ${rows[0].dialect}`,
  );

  const roundTripped = buildKpiPayload(rows);
  assert(
    roundTripped[0].dialect === CALC_DIALECT_V2,
    `read then sent unchanged, a v2 KPI must still be v2, got ${roundTripped[0].dialect}`,
  );
  assert(
    roundTripped[0].pointKeys.length === 0,
    `a KPI whose every reference is cross-asset declares no local point key (Q3b), got ` +
      `${JSON.stringify(roundTripped[0].pointKeys)}`,
  );

  // The failure path in full: the author edits a **different** KPI and saves.
  const edited = rows.map((entry, index) =>
    index === 1 ? { ...entry, name: "Chilled water delta T" } : entry,
  );
  const afterEditingAnother = buildKpiPayload(edited);
  assert(
    afterEditingAnother[0].dialect === CALC_DIALECT_V2,
    `editing one KPI must not rewrite another's dialect, got ${afterEditingAnother[0].dialect}`,
  );
  assert(
    afterEditingAnother[1].name === "Chilled water delta T",
    "…and the edit the author actually made must still be sent",
  );

  // A dialect this UI does not know still reads as unvalidated. The ternary
  // widened to the vocabulary, it did not become "trust whatever is stored".
  const [unknown] = kpiRowsFrom([{ ...storedV2, dialect: "bms-calc-v3" } as unknown as TemplateKpi]);
  assert(
    unknown.dialect === "unvalidated",
    `a dialect outside CALC_DIALECTS must read as unvalidated, got ${unknown.dialect}`,
  );
}

/**
 * A malformed stored entry renders instead of throwing.
 *
 * `content` is `z.record(z.unknown())` on the read side, so a row written
 * before ADR 0019 can hold anything. `[...kpi.pointKeys]` on an entry with no
 * `pointKeys` throws while **rendering** — and `unwritableContentKeys` blocks
 * the write, not the read, so nothing upstream stops that row reaching here.
 */
export function runMalformedStoredEntryTests(): void {
  // Deliberately built as `unknown` and cast at the boundary, the way the tab
  // does it, rather than typed into agreement with a shape the data may not
  // have.
  const junk = [
    {},
    { code: "A" },
    { code: "B", pointKeys: "not-an-array", expression: 42, dialect: "sideways" },
  ] as unknown as TemplateKpi[];

  const rows = kpiRowsFrom(junk);
  assert(rows.length === 3, "every stored entry produces a row");
  assert(
    rows.every((entry) => Array.isArray(entry.pointKeys)),
    "a missing or non-array pointKeys reads as an empty list rather than throwing",
  );
  assert(rows.every((entry) => typeof entry.expression === "string"), "expression is always text");
  assert(
    rows.every((entry) => entry.dialect === "unvalidated"),
    "an unrecognised dialect reads as unvalidated — the safe direction, which " +
      "suppresses the parser checks on a row this UI cannot vouch for",
  );
  assert(rows[1].code === "A", "the fields that are present survive");

  // And the rows are then reportable rather than silently broken.
  const problems = kpiFormErrors(rows, DECLARED);
  assert(problems.length > 0, "a malformed row is reported, not quietly accepted");
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

/**
 * **A stored `bms-calc-v2` KPI must not make the tab unsaveable, and Validate
 * must not rewrite it to `v1`.**
 *
 * Both are the same class as the Calculations tab stamping `v1` on every
 * formula edit: a control damaging a row it did not author. The owner's Q3
 * ruling widened `templateKpiSchema.dialect`, so a `v2` KPI is storable today
 * even though nothing evaluates one yet (ADR 0037 §"Not in this ADR"), and an
 * author who opens the tab to rename a *different* KPI must be able to save.
 *
 * Q3b is the rule underneath: `pointKeys` lists the **local** point keys the
 * expression reads, so a KPI whose every reference is cross-asset correctly has
 * `pointKeys: []`. The API refuses an empty array only when the parse also
 * found no cross-asset reference, and this mirrors that pair rather than
 * exempting `v2` wholesale — the third case below is the one that would pass if
 * the check were simply skipped.
 */
export function runV2KpiIsSaveableAndKeepsItsDialectTests(): void {
  const crossOnly = row({
    code: "SITE_KW",
    name: "Site load",
    expression: "sum({SITE_KW} @site)",
    pointKeys: [],
    dialect: CALC_DIALECT_V2,
  });
  assert(
    kpiFormErrors([crossOnly], DECLARED).length === 0,
    `a v2 KPI reading only other assets must be saveable — got ` +
      JSON.stringify(kpiFormErrors([crossOnly], DECLARED)),
  );

  // The narrowing is not a hole: with no cross-asset reference either, an empty
  // `pointKeys` is still a KPI that reads nothing.
  const readsNothing = row({ expression: "{FLOW}", pointKeys: [], dialect: CALC_DIALECT_V2 });
  assert(
    kpiFormErrors([readsNothing], DECLARED).some((problem) => problem.field === "pointKeys"),
    "a v2 KPI with no local keys and no cross-asset reference reads nothing and is refused",
  );

  // Validate leaves the dialect where it is, and — the case a null-ish fixture
  // would miss — keeps the local keys a mixed expression really reads.
  const mixed = row({
    code: "SHARE",
    name: "Share of site",
    expression: "{FLOW} / sum({FLOW} @site)",
    pointKeys: ["FLOW"],
    dialect: CALC_DIALECT_V2,
  });
  const validated = validateKpiRow(mixed, DECLARED);
  assert(
    validated.validation.state === "ok",
    `a mixed local/cross v2 expression validates — got ${JSON.stringify(validated.validation)}`,
  );
  assert(
    validated.row.dialect === CALC_DIALECT_V2,
    `Validate must not rewrite a v2 row to v1 — got "${validated.row.dialect}"`,
  );
  assert(
    validated.row.pointKeys.join(",") === "FLOW",
    `the local key must survive Validate — got ${JSON.stringify(validated.row.pointKeys)}`,
  );
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

/**
 * A validated KPI can never be saved broken, and never needs re-validating.
 *
 * The tab hides the Validate button once the dialect is `bms-calc-v1`, which
 * would be a trap if a validated row could reach Save in a state the server
 * refuses. It cannot, and the reason is worth pinning rather than re-deriving:
 *
 * - an **unparseable** expression derives no keys, so the `min(1)` check fires;
 * - an **unknown reference** appears in the derived keys, so the resolution
 *   check fires;
 * - the **two-way correspondence** the schema demands cannot fail at all,
 *   because the keys are computed from the expression rather than stored
 *   beside it.
 *
 * So the live error and the save gate agree, and an author who breaks a
 * validated expression fixes it in place and watches the error clear.
 */
export function runValidatedRowCannotSaveBrokenTests(): void {
  const unparseable = kpiFormErrors(
    [row({ dialect: CALC_DIALECT, expression: "{CHW_SUPPLY_T} +" })],
    DECLARED,
  );
  assert(
    unparseable.some((problem) => problem.field === "pointKeys"),
    `an unparseable validated expression blocks the save — got ${JSON.stringify(unparseable)}`,
  );

  const unknown = kpiFormErrors([row({ dialect: CALC_DIALECT, expression: "{NOPE}" })], DECLARED);
  assert(
    unknown.some((problem) => problem.message.includes("NOPE")),
    `an unknown reference blocks the save and names itself — got ${JSON.stringify(unknown)}`,
  );

  // The correspondence case: a stored array that disagrees with the expression
  // is simply ignored, so there is nothing left to disagree about.
  const mismatched = row({
    dialect: CALC_DIALECT,
    expression: "{FLOW}",
    pointKeys: ["CHW_SUPPLY_T", "CHW_RETURN_T"],
  });
  assert(
    kpiFormErrors([mismatched], DECLARED).length === 0,
    `a stale stored array cannot break a validated row — got ${JSON.stringify(kpiFormErrors([mismatched], DECLARED))}`,
  );
  assert(
    buildKpiPayload([mismatched])[0].pointKeys.join(",") === "FLOW",
    "…because the payload carries what the expression reads",
  );

  // And it does not read as an unsaved edit on load, because both sides of the
  // comparison derive the same way.
  const stored = buildKpiPayload([mismatched]) as TemplateKpi[];
  assert(
    !kpisHaveChanged(kpiRowsFrom(stored), stored),
    "a freshly loaded validated KPI reports no changes",
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
