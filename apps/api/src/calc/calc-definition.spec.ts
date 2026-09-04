import { CALC_DIALECT, CALC_DIALECT_V2, DEFAULT_MAX_INPUT_AGE_SECONDS } from "@bms/shared";

import { toActiveDefinition, type TemplatePointCalcRow } from "./calc-definition";

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
}
