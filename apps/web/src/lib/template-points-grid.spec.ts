/**
 * The Points tab's grid rules (`F2.5`, ADR 0038 Unit 9b).
 *
 * Fixtures are built through `adminAssetTemplateDtoSchema.parse(...)` rather
 * than cast, so a DTO field that changes shape fails here instead of letting
 * these assertions run against an object the API can no longer produce.
 */
import { adminAssetTemplateDtoSchema } from "@bms/shared/contracts";
import type { AdminAssetTemplateDto } from "@bms/shared";

import {
  MAX_TEMPLATE_POINTS,
  blankPointRow,
  brokenFormulaRefs,
  buildPointsPayload,
  pointGridErrors,
  pointRowsFrom,
  pointsHaveChanged,
  setPointKind,
  type TemplatePointRow,
} from "./template-points-grid";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function point(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    templateId: "t1",
    pointKey: "CHW_SUPPLY_T",
    label: "Supply temperature",
    unit: "degC",
    kind: "measured",
    sourceDataKeyPattern: "CH{unit}_CHW_SUPPLY_T",
    formula: null,
    formulaDialect: null,
    calcTrigger: null,
    calcIntervalSeconds: null,
    maxInputAgeSeconds: null,
    required: true,
    sortOrder: 0,
    createdAt: "2026-08-21T00:00:00.000Z",
    ...overrides,
  };
}

/** A derived point with every calc field set — the round-trip's subject. */
function derivedPoint(overrides: Record<string, unknown> = {}) {
  return point({
    id: "p2",
    pointKey: "COOLING_KW",
    label: "Cooling load",
    unit: "kW",
    kind: "derived",
    sourceDataKeyPattern: null,
    formula: "{CHW_SUPPLY_T} * 2",
    formulaDialect: "bms-calc-v1",
    calcTrigger: "scheduled",
    calcIntervalSeconds: 300,
    maxInputAgeSeconds: 600,
    sortOrder: 1,
    ...overrides,
  });
}

function template(points: unknown[]): AdminAssetTemplateDto {
  return adminAssetTemplateDtoSchema.parse({
    id: "t1",
    organizationId: "o1",
    organizationCode: "ESKOM",
    organizationName: "Ion Exchange",
    code: "CHILLER",
    version: 1,
    name: "Chiller",
    assetType: "chiller",
    domain: "hvac",
    description: null,
    status: "draft",
    content: {},
    publishedAt: null,
    archivedAt: null,
    stockCode: null,
    stockVersion: null,
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    points,
  });
}

/**
 * **The assertion this module exists for.**
 *
 * The grid edits seven fields; the server replaces the whole point set from
 * whatever the payload holds. A builder that sent only the seven would write
 * `null` over every derived point's `formula`, `formulaDialect`, `calcTrigger`,
 * `calcIntervalSeconds` and `maxInputAgeSeconds` — a valid request, accepted
 * silently, with the calc configuration gone.
 */
export function runCalcFieldsSurviveARoundTripTests(): void {
  const row = template([point(), derivedPoint()]);
  const payload = buildPointsPayload(pointRowsFrom(row));

  assert(payload.length === 2, `both points survive — got ${payload.length}`);

  const derived = payload[1];
  assert(derived.formula === "{CHW_SUPPLY_T} * 2", `formula lost — got ${derived.formula}`);
  assert(derived.formulaDialect === "bms-calc-v1", `dialect lost — got ${derived.formulaDialect}`);
  assert(derived.calcTrigger === "scheduled", `calcTrigger lost — got ${derived.calcTrigger}`);
  assert(derived.calcIntervalSeconds === 300, `interval lost — got ${derived.calcIntervalSeconds}`);
  assert(
    derived.maxInputAgeSeconds === 600,
    `maxInputAgeSeconds lost — got ${derived.maxInputAgeSeconds}`,
  );

  // Asserted as a set, not one key at a time: a sixth calc field added to the
  // DTO later must be carried too, and a per-field list would not notice.
  const sent = Object.keys(derived).sort().join(",");
  assert(
    sent ===
      "calcIntervalSeconds,calcTrigger,formula,formulaDialect,kind,label,maxInputAgeSeconds," +
        "pointKey,required,sortOrder,sourceDataKeyPattern,unit",
    `the payload must carry all twelve fields — got ${sent}`,
  );

  // An untouched grid round-trips to exactly what the server holds.
  assert(
    !pointsHaveChanged(pointRowsFrom(row), row),
    "loading and immediately saving must be a no-op — it deletes and reinserts every row",
  );
}

/** Seeding turns the nullable read fields into the strings the DOM holds. */
export function runSeedTests(): void {
  const rows = pointRowsFrom(template([point({ label: null, unit: null })]));
  assert(rows[0].label === "", "a null label seeds as empty text, not the string null");
  assert(rows[0].unit === "", "a null unit seeds as empty text");
  assert(rows[0].pointKey === "CHW_SUPPLY_T", "the key seeds as stored");
  assert(rows[0].required === true, "required seeds as stored");

  const blank = blankPointRow(rows);
  assert(blank.kind === "measured", "a new point starts measured — it has no formula");
  assert(blank.required === true, "a new point is required by default, matching the schema");
  assert(blank.sortOrder === 1, `a new row sorts after the last — got ${blank.sortOrder}`);
  assert(
    blank.formula === null && blank.calcTrigger === null,
    "a new point carries no calc configuration",
  );

  // The highest `sortOrder`, not the array length: a grid whose rows were
  // reordered by hand would otherwise append a duplicate ordering value.
  const gapped = blankPointRow([{ ...rows[0], sortOrder: 9 }]);
  assert(gapped.sortOrder === 10, `appends after the highest sortOrder — got ${gapped.sortOrder}`);
}

/** Empty optional boxes send `null`, never `""`. */
export function runEmptyOverridesBecomeNullTests(): void {
  const rows = pointRowsFrom(template([point()]));
  const cleared: TemplatePointRow = {
    ...rows[0],
    label: "",
    unit: "  ",
    sourceDataKeyPattern: "",
  };
  const [sent] = buildPointsPayload([cleared]);

  // `null` means "use the point-key catalog's value". `""` is an override that
  // happens to be empty, which renders as a point with a blank name instead of
  // falling back.
  assert(sent.label === null, `an emptied label sends null — got ${JSON.stringify(sent.label)}`);
  assert(sent.unit === null, `a whitespace unit sends null — got ${JSON.stringify(sent.unit)}`);
  assert(
    sent.sourceDataKeyPattern === null,
    `an emptied pattern sends null — got ${JSON.stringify(sent.sourceDataKeyPattern)}`,
  );

  const trimmed = buildPointsPayload([{ ...rows[0], pointKey: " CHW_SUPPLY_T " }]);
  assert(trimmed[0].pointKey === "CHW_SUPPLY_T", "keys are trimmed — a padded key is not in the catalog");
}

/**
 * The kind switch, and what each direction may carry.
 *
 * `templatePointBodySchema` refuses a measured point holding any of the five
 * calc fields, and refuses a derived point missing formula, dialect or trigger.
 */
export function runKindChangeTests(): void {
  const derived = pointRowsFrom(template([derivedPoint()]))[0];

  const measured = setPointKind(derived, "measured");
  assert(measured.kind === "measured", "the kind changes");
  assert(measured.formula === null, "derived to measured clears the formula");
  assert(measured.formulaDialect === null, "…and the dialect");
  assert(measured.calcTrigger === null, "…and the trigger");
  assert(measured.calcIntervalSeconds === null, "…and the interval");
  assert(measured.maxInputAgeSeconds === null, "…and the input age");
  assert(measured.pointKey === derived.pointKey, "nothing else changes");
  assert(measured.label === derived.label, "the label is untouched");

  // The other direction seeds nothing. ADR 0038 decision 4 puts the trigger on
  // the Calculations tab; a default chosen here would be ADR 0037's write
  // policy decided silently from a tab with no say in it.
  const plain = pointRowsFrom(template([point()]))[0];
  assert(plain.sourceDataKeyPattern !== "", "the fixture starts with a source pattern");
  const promoted = setPointKind(plain, "derived");
  assert(promoted.kind === "derived", "the kind changes");
  assert(
    promoted.calcTrigger === null,
    `measured to derived must not seed a trigger — got ${promoted.calcTrigger}`,
  );
  assert(promoted.formula === null, "…and must not seed a formula");
  // The instantiation service: "only measured points become rows … there is no
  // honest source_data_key" for a derived one. The schema has no cross-check
  // for this field, so a stale pattern is stored and ignored forever.
  assert(
    promoted.sourceDataKeyPattern === "",
    `a derived point has no source key pattern — got ${JSON.stringify(promoted.sourceDataKeyPattern)}`,
  );

  // Setting the kind it already has must not clear anything.
  const same = setPointKind(derived, "derived");
  assert(same.formula === derived.formula, "setting the same kind changes nothing");
}

/** Duplicates, blanks and the cap — the server's checks, worded for the author. */
export function runGridErrorTests(): void {
  const rows = pointRowsFrom(template([point(), derivedPoint()]));
  assert(pointGridErrors(rows).length === 0, "a valid grid has no problems");

  const duplicated = pointGridErrors([rows[0], { ...rows[0], sortOrder: 1 }]);
  assert(duplicated.length === 1, `one duplicate is one problem — got ${duplicated.length}`);
  assert(duplicated[0].row === 1, "reported against the second occurrence, not the first");
  assert(
    duplicated[0].message.includes("row 1"),
    `the message names the row it collided with — got ${duplicated[0].message}`,
  );

  const blank = pointGridErrors([{ ...rows[0], pointKey: "   " }]);
  assert(blank.length === 1 && blank[0].field === "pointKey", "a blank key is refused");

  // Two blank keys are two blank-key problems, not a duplicate: reporting
  // `"" is already used by row 1` would be nonsense.
  const twoBlanks = pointGridErrors([
    { ...rows[0], pointKey: "" },
    { ...rows[0], pointKey: "" },
  ]);
  assert(
    twoBlanks.length === 2 && twoBlanks.every((problem) => problem.field === "pointKey"),
    `two empty rows are two blank-key problems — got ${JSON.stringify(twoBlanks)}`,
  );

  const tooMany = pointGridErrors(
    Array.from({ length: MAX_TEMPLATE_POINTS + 1 }, (_, index) => ({
      ...rows[0],
      pointKey: `KEY_${index}`,
      sortOrder: index,
    })),
  );
  assert(
    tooMany.some((problem) => problem.row === null && problem.field === "points"),
    "the 500-point cap is reported against the grid, not a row",
  );
  assert(
    pointGridErrors(
      Array.from({ length: MAX_TEMPLATE_POINTS }, (_, index) => ({
        ...rows[0],
        pointKey: `KEY_${index}`,
        sortOrder: index,
      })),
    ).length === 0,
    "exactly 500 is allowed — the schema is .max(500), which is inclusive",
  );
}

/** A derived point this tab cannot complete is refused here, not by the server. */
export function runIncompleteDerivedPointTests(): void {
  const plain = pointRowsFrom(template([point()]))[0];
  const promoted = setPointKind(plain, "derived");

  const problems = pointGridErrors([promoted]);
  assert(problems.length === 1, `one problem — got ${JSON.stringify(problems)}`);
  assert(problems[0].field === "kind", "reported against the control the author touched");
  assert(
    problems[0].message.includes("Calculations tab"),
    `the message must say where to finish it — got ${problems[0].message}`,
  );

  // The mirror case: a measured point carrying a formula. Reachable only if
  // something bypassed `setPointKind`, which is exactly why it is checked.
  const mixed = pointGridErrors([{ ...plain, formula: "{X} * 2" }]);
  assert(mixed.length === 1 && mixed[0].field === "kind", "a measured point may not hold a formula");
}

/**
 * Cross-point breakage, which is the half a Zod path cannot explain.
 *
 * The server reports these against the *formula's* row. The author edited a
 * different row.
 */
export function runBrokenFormulaRefTests(): void {
  const rows = pointRowsFrom(template([point(), derivedPoint()]));
  assert(brokenFormulaRefs(rows).length === 0, "an intact template has no broken references");

  // The key the formula reads was renamed. This is the case that would have
  // been silently skipped by `validateFormula`, which reports the whole formula
  // unparseable the moment a ref is outside the set it is handed.
  const renamed = brokenFormulaRefs([{ ...rows[0], pointKey: "CHW_SUPPLY_TEMP" }, rows[1]]);
  assert(renamed.length === 1, `a renamed key breaks its dependant — got ${renamed.length}`);
  assert(renamed[0].row === 1, "reported against the formula's row");
  assert(
    renamed[0].message.includes("CHW_SUPPLY_T") && renamed[0].message.includes("no longer"),
    `the message names the missing key — got ${renamed[0].message}`,
  );

  // The referenced point became derived. ADR 0036 decision 7: a derived formula
  // may only reference measured points.
  const promoted = brokenFormulaRefs([setPointKind(rows[0], "derived"), rows[1]]);
  assert(
    promoted.some((problem) => problem.row === 1 && problem.message.includes("now derived")),
    `a promoted reference is reported — got ${JSON.stringify(promoted)}`,
  );

  // The point removed outright, rather than renamed.
  const deleted = brokenFormulaRefs([rows[1]]);
  assert(deleted.length === 1, "deleting a referenced point breaks its dependant");

  // A formula that does not parse is not this tab's problem to report.
  const unparseable = brokenFormulaRefs([rows[0], { ...rows[1], formula: "{{{" }]);
  assert(
    unparseable.length === 0,
    `a parse error belongs to the Calculations tab — got ${JSON.stringify(unparseable)}`,
  );

  // `pointGridErrors` includes these, so the tab has one list to render.
  const combined = pointGridErrors([{ ...rows[0], pointKey: "RENAMED" }, rows[1]]);
  assert(
    combined.some((problem) => problem.field === "formula"),
    "broken references appear in the grid's problem list",
  );
}

/** A change is what would actually be sent, not what was typed. */
export function runChangeDetectionTests(): void {
  const row = template([point(), derivedPoint()]);
  const rows = pointRowsFrom(row);

  assert(!pointsHaveChanged(rows, row), "an untouched grid has no changes");
  assert(
    !pointsHaveChanged([{ ...rows[0], label: "Supply temperature " }, rows[1]], row),
    "a trailing space is trimmed before sending, so it is not a change",
  );
  assert(pointsHaveChanged([{ ...rows[0], label: "Supply T" }, rows[1]], row), "a real edit is a change");
  assert(pointsHaveChanged([rows[0]], row), "removing a point is a change");
  assert(
    pointsHaveChanged([rows[1], rows[0]], row),
    "reordering the array is a change — the payload order is what the grid shows",
  );
}
