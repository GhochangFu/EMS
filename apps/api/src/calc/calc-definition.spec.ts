import { CALC_DIALECT, CALC_DIALECT_V2, DEFAULT_MAX_INPUT_AGE_SECONDS } from "@bms/shared";

import {
  referencesADerivedSiblingUnderV1,
  toActiveDefinition,
  type CalcDefinition,
  type TemplatePointCalcRow,
} from "./calc-definition";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const BASE: TemplatePointCalcRow = {
  templatePointId: "tp-1",
  assetId: "asset-1",
  pointKey: "TOTAL_KWH",
  kind: "derived",
  formula: "{A} + {B}",
  formulaDialect: "bms-calc-v1",
  calcTrigger: "streaming",
  calcIntervalSeconds: null,
  maxInputAgeSeconds: null,
  minCoverageRatio: null,
};

export function runCalcDefinitionTests(): void {
  // ---- a row that never passed templatePointBodySchema is a counted skip, ----
  // ---- never a throw and never a default -------------------------------------

  const measured = toActiveDefinition({ ...BASE, kind: "measured" });
  assert(measured.ok === false && measured.reason === "not_derived", "a measured row must skip as not_derived");

  const preF23 = toActiveDefinition({ ...BASE, formula: null, formulaDialect: null });
  assert(
    preF23.ok === false && preF23.reason === "no_formula",
    "a pre-F2.3 derived row with formula: null must skip as no_formula, not throw",
  );

  const badDialect = toActiveDefinition({ ...BASE, formulaDialect: "unvalidated" });
  assert(badDialect.ok === false && badDialect.reason === "bad_dialect", "a dialect outside CALC_DIALECTS must skip");

  const unknownDialect = toActiveDefinition({ ...BASE, formulaDialect: "bms-calc-v3" });
  assert(
    unknownDialect.ok === false && unknownDialect.reason === "bad_dialect",
    "a dialect this engine does not know must skip as bad_dialect, never be parsed as v1",
  );

  const unparseable = toActiveDefinition({ ...BASE, formula: "{A} +" });
  assert(
    unparseable.ok === false && unparseable.reason === "unparseable_formula",
    "a formula that fails to parse must skip, not throw",
  );

  // ---- a row with calc_trigger: null (every existing derived row, pre-F2.4) --

  const noTrigger = toActiveDefinition({ ...BASE, calcTrigger: null });
  assert(
    noTrigger.ok === false && noTrigger.reason === "no_trigger",
    "calc_trigger: null must skip as no_trigger — never assumed to be streaming or scheduled",
  );

  // ---- trigger/interval cross-checks ------------------------------------------

  const intervalOnStreaming = toActiveDefinition({ ...BASE, calcTrigger: "streaming", calcIntervalSeconds: 60 });
  assert(
    intervalOnStreaming.ok === false && intervalOnStreaming.reason === "interval_on_streaming",
    "a streaming row carrying an interval must skip",
  );

  const missingInterval = toActiveDefinition({ ...BASE, calcTrigger: "scheduled", calcIntervalSeconds: null });
  assert(
    missingInterval.ok === false && missingInterval.reason === "missing_interval",
    "a scheduled row with no interval must skip",
  );

  const intervalTooLow = toActiveDefinition({ ...BASE, calcTrigger: "scheduled", calcIntervalSeconds: 5 });
  assert(
    intervalTooLow.ok === false && intervalTooLow.reason === "interval_out_of_range",
    "a scheduled interval below the 10s floor must skip",
  );

  const maxAgeTooHigh = toActiveDefinition({ ...BASE, maxInputAgeSeconds: 999_999 });
  assert(
    maxAgeTooHigh.ok === false && maxAgeTooHigh.reason === "max_input_age_out_of_range",
    "a maxInputAgeSeconds above the bound must skip",
  );

  // ---- the coverage ratio's (0, 1] bound, re-checked at read time (finding 32) --
  // The same convention as the two bounds above: the Zod layer enforces it, and
  // this re-checks it for exactly the rows that never passed the Zod layer. The
  // boundary at 1 is the one that matters — `1` means "every member" and an
  // exclusive slip there would silently disable fail-closed for that ratio.

  const ratioZero = toActiveDefinition({ ...BASE, calcTrigger: "scheduled", calcIntervalSeconds: 300, minCoverageRatio: 0 });
  assert(
    ratioZero.ok === false && ratioZero.reason === "coverage_ratio_out_of_range",
    `a min_coverage_ratio of 0 is outside (0, 1] and must skip, got ${ratioZero.ok ? "ok" : ratioZero.reason}`,
  );
  const ratioAboveOne = toActiveDefinition({
    ...BASE,
    calcTrigger: "scheduled",
    calcIntervalSeconds: 300,
    minCoverageRatio: 1.5,
  });
  assert(
    ratioAboveOne.ok === false && ratioAboveOne.reason === "coverage_ratio_out_of_range",
    `a min_coverage_ratio above 1 must skip, got ${ratioAboveOne.ok ? "ok" : ratioAboveOne.reason}`,
  );
  const ratioNaN = toActiveDefinition({ ...BASE, calcTrigger: "scheduled", calcIntervalSeconds: 300, minCoverageRatio: NaN });
  assert(
    ratioNaN.ok === false && ratioNaN.reason === "coverage_ratio_out_of_range",
    `a NaN ratio (a numeric column admits one) must skip, not pass a comparison vacuously, got ${
      ratioNaN.ok ? "ok" : ratioNaN.reason
    }`,
  );
  const ratioOne = toActiveDefinition({ ...BASE, calcTrigger: "scheduled", calcIntervalSeconds: 300, minCoverageRatio: 1 });
  assert(
    ratioOne.ok === true && ratioOne.def.minCoverageRatio === 1,
    `a min_coverage_ratio of exactly 1 is inside the bound and must resolve, got ${ratioOne.ok ? "ok" : ratioOne.reason}`,
  );
  const ratioHalf = toActiveDefinition({ ...BASE, calcTrigger: "scheduled", calcIntervalSeconds: 300, minCoverageRatio: 0.5 });
  assert(ratioHalf.ok === true && ratioHalf.def.minCoverageRatio === 0.5, "a ratio inside the bound carries through");

  // ---- a valid scheduled row resolves the default when unset -----------------

  const validScheduled = toActiveDefinition({ ...BASE, calcTrigger: "scheduled", calcIntervalSeconds: 300 });
  assert(validScheduled.ok === true, "a valid scheduled row must produce a definition");
  if (validScheduled.ok) {
    assert(
      validScheduled.def.maxInputAgeSeconds === DEFAULT_MAX_INPUT_AGE_SECONDS,
      `maxInputAgeSeconds must default to ${DEFAULT_MAX_INPUT_AGE_SECONDS} when the row leaves it unset`,
    );
    assert(validScheduled.def.intervalSeconds === 300, "intervalSeconds must carry through unchanged");
    assert(validScheduled.def.refs.join(",") === "A,B", "refs must come from the parsed formula");
    assert(validScheduled.def.dialect === CALC_DIALECT, "a v1 row must resolve to the v1 dialect");
    assert(
      validScheduled.def.crossRefs.length === 0,
      "a v1 formula can name no cross-asset reference, so crossRefs must be empty",
    );
    assert(
      validScheduled.def.minCoverageRatio === null,
      "a row with no min_coverage_ratio must carry null — decision 11's fail-closed value, not a default",
    );
  }

  // ---- a valid streaming row resolves with intervalSeconds forced to null -----

  const validStreaming = toActiveDefinition({ ...BASE, maxInputAgeSeconds: 120 });
  assert(validStreaming.ok === true, "a valid streaming row must produce a definition");
  if (validStreaming.ok) {
    assert(validStreaming.def.intervalSeconds === null, "a streaming definition must never carry an interval");
    assert(validStreaming.def.maxInputAgeSeconds === 120, "an explicit maxInputAgeSeconds must be preserved");
  }

  // ---- ADR 0055: a `bms-calc-v2` row is parsed under its own dialect ----------
  // The row is *resolved* here; whether the host evaluates it is a separate
  // question (`calc-scheduler.spec.ts` holds the refusal).

  const v2Scheduled = toActiveDefinition({
    ...BASE,
    formula: "sum({A} @site)",
    formulaDialect: CALC_DIALECT_V2,
    calcTrigger: "scheduled",
    calcIntervalSeconds: 300,
    minCoverageRatio: 0.8,
  });
  assert(
    v2Scheduled.ok === true,
    `a v2 scheduled row must resolve, got ${v2Scheduled.ok ? "ok" : v2Scheduled.reason}`,
  );
  if (v2Scheduled.ok) {
    assert(
      v2Scheduled.def.dialect === CALC_DIALECT_V2,
      "the definition must carry the dialect it was parsed under, not the v1 default",
    );
    assert(
      v2Scheduled.def.crossRefs.length === 1,
      `an aggregate is one cross reference, got ${v2Scheduled.def.crossRefs.length}`,
    );
    assert(
      v2Scheduled.def.refs.length === 0,
      "an aggregate's point key is a cross reference, never a local ref — the two lists are separate",
    );
    assert(v2Scheduled.def.minCoverageRatio === 0.8, "min_coverage_ratio must carry through unchanged");
  }

  // A v2 row parsed as v1 would fail to parse at the `@`, so this also proves
  // the dialect reaches parseFormula rather than being validated and dropped.
  const v2ParsedAsV1 = toActiveDefinition({
    ...BASE,
    formula: "sum({A} @site)",
    calcTrigger: "scheduled",
    calcIntervalSeconds: 300,
  });
  assert(
    v2ParsedAsV1.ok === false && v2ParsedAsV1.reason === "unparseable_formula",
    "v2 syntax stored under the v1 dialect must still be refused — decision 3 freezes v1's meaning",
  );

  // ---- the self-reference backstop (`F2.9` finding 34) ------------------------
  // Dialect-independent on purpose: the failure it backstops is a stored row
  // whose dialect label does not describe its formula, so a guard that read the
  // label would be the guard the failure walks past.

  const selfReferenceUnderV1 = toActiveDefinition({
    ...BASE,
    pointKey: "TOTAL_KWH",
    formula: "{TOTAL_KWH} * 2",
    calcTrigger: "scheduled",
    calcIntervalSeconds: 300,
  });
  assert(
    selfReferenceUnderV1.ok === false && selfReferenceUnderV1.reason === "self_reference",
    `a v1 definition whose refs contain its own pointKey must skip as self_reference, got ${
      selfReferenceUnderV1.ok ? "ok" : selfReferenceUnderV1.reason
    }`,
  );

  const selfReferenceUnderV2 = toActiveDefinition({
    ...BASE,
    pointKey: "TOTAL_KWH",
    formula: "{TOTAL_KWH} * 2",
    formulaDialect: CALC_DIALECT_V2,
    calcTrigger: "scheduled",
    calcIntervalSeconds: 300,
  });
  assert(
    selfReferenceUnderV2.ok === false && selfReferenceUnderV2.reason === "self_reference",
    `the same formula under v2 must skip identically — the guard reads refs, never the dialect, got ${
      selfReferenceUnderV2.ok ? "ok" : selfReferenceUnderV2.reason
    }`,
  );

  // The other half of the guard: it must refuse a self-reference and nothing
  // else. `{OTHER}` on a point named `TOTAL_KWH` is an ordinary sibling
  // reference and stays active — a backstop that also stopped these would take
  // every derived point in the stock catalog down with it.
  const siblingReference = toActiveDefinition({
    ...BASE,
    pointKey: "TOTAL_KWH",
    formula: "{OTHER} * 2",
    calcTrigger: "scheduled",
    calcIntervalSeconds: 300,
  });
  assert(
    siblingReference.ok === true,
    `a definition referencing a different point must stay active, got ${
      siblingReference.ok ? "ok" : siblingReference.reason
    }`,
  );

  // ---- decision 10 mirrored on the stored row (defence in depth) --------------
  // The Zod rule refuses `v2` + `streaming` at save. A row copied forward
  // unvalidated by `createDraftFrom` never passed that rule, so the loader
  // refuses it again — as a counted skip with its own reason, not silently.

  const v2Streaming = toActiveDefinition({
    ...BASE,
    formula: "sum({A} @site)",
    formulaDialect: CALC_DIALECT_V2,
    calcTrigger: "streaming",
  });
  assert(
    v2Streaming.ok === false && v2Streaming.reason === "streaming_on_v2",
    `a v2 row triggered streaming must skip as streaming_on_v2, got ${
      v2Streaming.ok ? "ok" : v2Streaming.reason
    }`,
  );

  runDerivedSiblingTests();
}

/**
 * `F2.9` — the `v1`-references-a-derived-point backstop. ADR 0036 decision 7
 * bans it, ADR 0055 decision 3 freezes that ban for `v1` forever, and this is
 * the read-time half of it. The set is **per asset**: a point key is an
 * org-scoped catalog code, and the same code is measured on one template and
 * derived on another.
 */
function runDerivedSiblingTests(): void {
  const scheduled = { calcTrigger: "scheduled", calcIntervalSeconds: 300 } as const;
  const activeDef = (row: Partial<TemplatePointCalcRow>): CalcDefinition => {
    const result = toActiveDefinition({ ...BASE, ...scheduled, ...row });
    if (!result.ok) {
      throw new Error(`this test's fixture row must resolve to a definition, got ${result.reason}`);
    }
    return result.def;
  };

  // `asset-1` has two derived points; `asset-2` declares only one of the same
  // two codes derived — `TOTAL_KWH` is measured there.
  const derivedByAsset = new Map<string, ReadonlySet<string>>([
    ["asset-1", new Set(["TOTAL_KWH", "OTHER_DERIVED"])],
    ["asset-2", new Set(["OTHER_DERIVED"])],
  ]);

  const v1OnDerived = activeDef({ pointKey: "TOTAL_KWH", formula: "{OTHER_DERIVED} * 2" });
  assert(
    referencesADerivedSiblingUnderV1(v1OnDerived, derivedByAsset),
    "a v1 formula referencing a derived point on the same asset is what ADR 0036 decision 7 bans",
  );

  // The over-refusal guard, and the one that matters most: every derived point
  // in the stock catalog is exactly this shape.
  const v1OnMeasured = activeDef({ pointKey: "TOTAL_KWH", formula: "{A} + {B}" });
  assert(
    !referencesADerivedSiblingUnderV1(v1OnMeasured, derivedByAsset),
    "a v1 formula over measured siblings must never be refused — that is every stock derived point",
  );

  // ADR 0055 decision 7 repeals the ban for `v2`. A `v2` definition that reads
  // a derived point is ordered after it by the sweep and refused only on a
  // cycle (`dependency_cycle`), never here — folding the two together would
  // delete decision 7.
  const v2OnDerived = activeDef({
    pointKey: "TOTAL_KWH",
    formula: "{OTHER_DERIVED} * 2",
    formulaDialect: CALC_DIALECT_V2,
  });
  assert(
    !referencesADerivedSiblingUnderV1(v2OnDerived, derivedByAsset),
    "a v2 formula may read a derived point (ADR 0055 decision 7) — this check is v1's rule only",
  );

  // Per asset, not global. `TOTAL_KWH` is derived on `asset-1` and measured on
  // `asset-2`; a global set would refuse this and break cross-asset work before
  // PR 2 starts.
  const sameKeyOnAnotherAsset = activeDef({
    assetId: "asset-2",
    pointKey: "OTHER_DERIVED",
    formula: "{TOTAL_KWH} * 2",
  });
  assert(
    !referencesADerivedSiblingUnderV1(sameKeyOnAnotherAsset, derivedByAsset),
    "the derived key set is per asset — the same code measured on another asset must stay active",
  );

  const onAnUnknownAsset = activeDef({ assetId: "asset-404", formula: "{OTHER_DERIVED} * 2" });
  assert(
    !referencesADerivedSiblingUnderV1(onAnUnknownAsset, derivedByAsset),
    "an asset with no entry in the map has no derived siblings, and must not throw",
  );
}
