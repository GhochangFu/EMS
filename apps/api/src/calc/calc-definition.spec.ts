import { DEFAULT_MAX_INPUT_AGE_SECONDS } from "@bms/shared";

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
  assert(badDialect.ok === false && badDialect.reason === "bad_dialect", "a non-bms-calc-v1 dialect must skip");

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
  }

  // ---- a valid streaming row resolves with intervalSeconds forced to null -----

  const validStreaming = toActiveDefinition({ ...BASE, maxInputAgeSeconds: 120 });
  assert(validStreaming.ok === true, "a valid streaming row must produce a definition");
  if (validStreaming.ok) {
    assert(validStreaming.def.intervalSeconds === null, "a streaming definition must never carry an interval");
    assert(validStreaming.def.maxInputAgeSeconds === 120, "an explicit maxInputAgeSeconds must be preserved");
  }
}
