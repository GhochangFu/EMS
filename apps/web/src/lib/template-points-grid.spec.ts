/**
 * The Points tab's grid rules (`F2.5`, ADR 0038 Unit 9b).
 *
 * Fixtures are built through `adminAssetTemplateDtoSchema.parse(...)` rather
 * than cast, so a DTO field that changes shape fails here instead of letting
 * these assertions run against an object the API can no longer produce.
 */
import { adminAssetTemplateDtoSchema, adminTemplatePointDtoSchema } from "@bms/shared/contracts";
import type { AdminAssetTemplateDto } from "@bms/shared";

import {
  MAX_TEMPLATE_POINTS,
  TEMPLATE_POINT_TIERS,
  blankPointRow,
  brokenFormulaRefs,
  buildPointsPayload,
  pointGridErrors,
  pointRowsFrom,
  pointsHaveChanged,
  setPointKind,
  setPointTier,
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
    // ADR 0055 decision 11 (`F2.9` Task 5). Read-side only for now: the grid's
    // own row type and `buildPointsPayload` carry it from Task 15, and the
    // twelve-field key assertion below is what will force that.
    minCoverageRatio: null,
    required: true,
    sortOrder: 0,
    meta: null,
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

/**
 * A `bms-calc-v2` derived point carrying a **non-null** `minCoverageRatio`.
 *
 * Separate from `derivedPoint` rather than a flipped field on it, because every
 * other case in this file reads that fixture and a ratio on them would be
 * refused by `templatePointBodySchema` (ADR 0055 decision 11: only a `v2`
 * derived point may carry one).
 *
 * **0.8, never `null`.** A `null` fixture passes whether the field is carried
 * or discarded, which is exactly how the discard this row fixes survived the
 * suite in the first place.
 */
function v2DerivedPoint(overrides: Record<string, unknown> = {}) {
  return derivedPoint({
    id: "p3",
    pointKey: "SITE_KW",
    label: "Site load",
    formula: "sum({CHW_SUPPLY_T} @site)",
    formulaDialect: "bms-calc-v2",
    calcTrigger: "scheduled",
    calcIntervalSeconds: 300,
    minCoverageRatio: 0.8,
    sortOrder: 2,
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
        "minCoverageRatio,pointKey,required,sortOrder,sourceDataKeyPattern,unit",
    `the payload must carry all thirteen fields — got ${sent}`,
  );

  // An untouched grid round-trips to exactly what the server holds.
  assert(
    !pointsHaveChanged(pointRowsFrom(row), row),
    "loading and immediately saving must be a no-op — it deletes and reinserts every row",
  );
}

/**
 * **`F2.9` finding 39 — `minCoverageRatio` is carried, or the first save from
 * either tab silently stops a working formula.**
 *
 * The same shape as the calc fields above, with a sharper consequence. ADR 0055
 * decision 11 makes an absent ratio **fail closed**: the aggregate refuses
 * rather than computing over whatever members happen to be fresh. So a grid
 * that dropped the field would send `minCoverageRatio: null` for a stock `v2`
 * point, the server would accept it, and the formula would stop producing
 * values with nothing on screen saying why. The value itself is unrecoverable
 * — it lives in no other column.
 *
 * `setPointKind` clears it on derived → measured, because
 * `templatePointBodySchema` refuses the ratio on anything that is not a `v2`
 * derived point; leaving it would turn a kind change into a 400 naming a field
 * this grid never showed.
 */
export function runMinCoverageRatioSurvivesARoundTripTests(): void {
  const row = template([point(), derivedPoint(), v2DerivedPoint()]);
  const rows = pointRowsFrom(row);

  assert(
    rows[2].minCoverageRatio === 0.8,
    `the grid row must hold the stored ratio, got ${JSON.stringify(rows[2].minCoverageRatio)}`,
  );

  const payload = buildPointsPayload(rows);
  assert(
    payload[2].minCoverageRatio === 0.8,
    `minCoverageRatio lost on the round trip — got ${JSON.stringify(payload[2].minCoverageRatio)}`,
  );
  assert(
    payload[1].minCoverageRatio === null,
    `a v1 derived point carries null, not undefined — got ${JSON.stringify(payload[1].minCoverageRatio)}`,
  );

  assert(
    !pointsHaveChanged(rows, row),
    "loading and immediately saving a v2 point must still be a no-op",
  );

  // A new row starts with no ratio: `blankPointRow` is measured, and only a
  // `v2` derived point may carry one.
  assert(
    blankPointRow(rows).minCoverageRatio === null,
    "a blank row carries no ratio",
  );

  // derived → measured clears it, alongside the five calc fields.
  const measured = setPointKind(rows[2], "measured");
  assert(
    measured.minCoverageRatio === null,
    `derived → measured must clear the ratio, got ${JSON.stringify(measured.minCoverageRatio)}`,
  );
}

/**
 * `brokenFormulaRefs` reads each row under **its own** dialect.
 *
 * Two rules, and only one of them is dialect-dependent:
 *
 * - "no longer in this template" stays under **both** dialects. A local `{ref}`
 *   naming a key the grid no longer holds is broken however it is parsed, and
 *   it is this tab's edit that broke it.
 * - "which is now derived" is ADR 0036 decision 7, and ADR 0055 decision 7
 *   repeals it for `v2`. Reporting it on a `v2` row would refuse the dialect's
 *   own purpose, on a tab with no way to fix it.
 *
 * The `v1` control below is the anti-vacuity half: the identical formula on a
 * `v1` row still reports **both** problems, so "not reported under `v2`" cannot
 * be satisfied by reporting nothing anywhere.
 *
 * Parsing under the row's dialect is what makes any of this reachable —
 * `parseFormula` under `v1` fails at the `@` of an aggregate, and a formula
 * that does not parse is skipped entirely.
 */
export function runBrokenFormulaRefsReadTheRowsDialectTests(): void {
  const rows = pointRowsFrom(
    template([
      point(),
      derivedPoint(),
      v2DerivedPoint({ formula: "{COOLING_KW} + {GONE}" }),
    ]),
  );

  const underV2 = brokenFormulaRefs(rows).filter((problem) => problem.row === 2);
  assert(
    underV2.length === 1,
    `a v2 row reports only the removed key — got ${JSON.stringify(underV2)}`,
  );
  assert(
    underV2[0].message.includes('"GONE"') &&
      underV2[0].message.includes("no longer in this template"),
    `the removed-key message must name GONE, got: ${underV2[0].message}`,
  );
  assert(
    !underV2.some((problem) => problem.message.includes("is now derived")),
    "ADR 0055 decision 7 — a v2 formula may reference a derived sibling",
  );

  const asV1 = rows.map((row, index) =>
    index === 2 ? { ...row, formulaDialect: "bms-calc-v1" as const } : row,
  );
  const underV1 = brokenFormulaRefs(asV1).filter((problem) => problem.row === 2);
  assert(
    underV1.length === 2,
    `the same formula on a v1 row reports both problems — got ${JSON.stringify(underV1)}`,
  );
  assert(
    underV1.some((problem) => problem.message.includes("is now derived")),
    "decision 3 freezes the v1 refusal: it must still fire",
  );

  // A key that exists only inside an aggregate is not a local reference, so the
  // "no longer in this template" rule does not reach it — the asset it resolves
  // against is another one. Under `v1` the same text does not parse at all.
  const crossOnly = pointRowsFrom(
    template([point(), v2DerivedPoint({ formula: "sum({SITE_TOTAL} @site)" })]),
  );
  assert(
    brokenFormulaRefs(crossOnly).length === 0,
    `a cross-asset reference is exempt — got ${JSON.stringify(brokenFormulaRefs(crossOnly))}`,
  );
}

/**
 * `F2.13` — `meta.tier` is carried too, or the Points tab erases it.
 *
 * `replacePoints` writes `meta: point.meta ?? {}` on every save, so a payload
 * with no `meta` resets every point's tier to nothing. Every stock-imported
 * template (ADR 0052 decision 2) carries a tier on all of its points, and one
 * save of the Points tab would silently strip all 33 — a valid request, 200,
 * and the client's redline marking gone. Found while building pass B of
 * `F2.13`; this row is what makes the tier authorable, so it is the row that
 * must not lose it.
 *
 * The write shape is closed: `templatePointBodySchema.meta` is optional but,
 * when present, `{ tier }` and nothing else. So a point with no tier must
 * **omit the key**, never send `meta: null` (refused) or `meta: {}` (refused
 * — `tier` is required once the object is present).
 */
export function runPointMetaSurvivesARoundTripTests(): void {
  const row = template([
    point({ meta: { tier: "core" } }),
    derivedPoint({ meta: null }),
    point({ id: "p3", pointKey: "CHW_RETURN_T", sortOrder: 2, meta: {} }),
  ]);
  const rows = pointRowsFrom(row);
  const payload = buildPointsPayload(rows);

  assert(
    JSON.stringify(payload[0].meta) === JSON.stringify({ tier: "core" }),
    `meta.tier lost on the round trip — got ${JSON.stringify(payload[0].meta)}`,
  );
  assert(
    !("meta" in payload[1]),
    `a point with meta: null must omit the key, not send ${JSON.stringify(payload[1].meta)}`,
  );
  assert(
    !("meta" in payload[2]),
    "a point whose stored meta is {} (the column default) has no tier and must omit the key — " +
      `sending {} is refused because tier is required once meta is present; got ${JSON.stringify(payload[2].meta)}`,
  );

  // Untouched, the tiered grid is still a no-op save.
  assert(
    !pointsHaveChanged(rows, row),
    "loading a tiered template and saving must be a no-op",
  );

  // A kind change keeps the tier: it is provenance, not calc configuration.
  const measured = setPointKind(rows[0], "derived");
  assert(
    JSON.stringify(measured.meta) === JSON.stringify({ tier: "core" }),
    "setPointKind must not clear meta — the tier is not one of the five calc fields",
  );

  // A new row has no tier; the server's default `{}` is what it will hold.
  assert(blankPointRow(rows).meta === null, "a blank row carries no tier");
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

/**
 * `F2.15` / ADR 0038 Amendment 5 Part A — the tier is authorable.
 *
 * `F2.13` proved the tier *survives* a round trip. What was asserted nowhere,
 * and is what the Tier control depends on, is that a tier-only edit is a change
 * (or Save never enables and the control does nothing), that the three values
 * are named once in a list the contract can be checked against, and that
 * **nothing validates the tier** — Amendment 5 keeps it provenance, not
 * behaviour, so `pointGridErrors` must stay silent about it.
 *
 * The empty option is not a convenience. `template_points.meta` defaults to
 * `{}`, so a hand-authored point legitimately has no tier; a select that could
 * not express that stored state would assign one silently on the next save.
 */
export function runTierAuthoringTests(): void {
  // The order is the order the select offers, so it is asserted as a sequence
  // rather than as a set.
  assert(
    JSON.stringify(TEMPLATE_POINT_TIERS) === JSON.stringify(["core", "extended", "manual"]),
    `the tier list must be core, extended, manual in that order — got ${JSON.stringify(TEMPLATE_POINT_TIERS)}`,
  );
  // Checked against the contract, not against a second literal: a tier the
  // select offers that the schema refuses would be a 400 the author cannot see
  // coming.
  for (const tier of TEMPLATE_POINT_TIERS) {
    assert(
      adminTemplatePointDtoSchema.shape.meta.parse({ tier })?.tier === tier,
      `"${tier}" must parse through the DTO's meta schema`,
    );
  }
  let refused = false;
  try {
    adminTemplatePointDtoSchema.shape.meta.parse({ tier: "bogus" });
  } catch {
    refused = true;
  }
  assert(refused, "a tier outside the contract's enum must not parse — the list is not free text");

  const row = template([point({ meta: { tier: "core" } }), derivedPoint()]);
  const rows = pointRowsFrom(row);

  // Setting a tier touches `meta` and nothing else.
  const manual = setPointTier(rows[0], "manual");
  assert(
    JSON.stringify(manual.meta) === JSON.stringify({ tier: "manual" }),
    `setPointTier must set the tier — got ${JSON.stringify(manual.meta)}`,
  );
  assert(
    JSON.stringify({ ...manual, meta: null }) === JSON.stringify({ ...rows[0], meta: null }),
    "setPointTier must leave every other field identical",
  );

  // The empty option clears the tier, and anything the contract does not offer
  // is treated the same way rather than written through to the wire.
  assert(setPointTier(rows[0], "").meta === null, 'the empty option clears the tier');
  assert(
    setPointTier(rows[0], "bogus").meta === null,
    "a value outside the contract's enum clears rather than being carried to a 400",
  );

  // **This is what makes Save enable.** Without it the Tier select would change
  // the row and leave the button disabled.
  const changed = [manual, rows[1]];
  assert(pointsHaveChanged(changed, row), "a tier-only change is a change worth saving");
  assert(
    !pointsHaveChanged([setPointTier(manual, "core"), rows[1]], row),
    "setting the tier back matches what is stored again, so Save disables itself",
  );

  // Amendment 5: the tier stays provenance. Nothing branches on it, including
  // validation — a tier change can never make the grid unsavable.
  assert(
    pointGridErrors(changed).length === 0,
    `no rule may branch on the tier — got ${JSON.stringify(pointGridErrors(changed))}`,
  );
  assert(
    pointGridErrors([setPointTier(rows[0], ""), rows[1]]).length === 0,
    "clearing the tier is not a validation problem either",
  );
}
