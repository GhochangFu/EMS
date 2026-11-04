import { expect } from "vitest";
import { CALC_POINT_BATCH_MAX_ASSETS } from "@bms/shared";
import { assetPointCalcConfigDtoSchema, calcPointSetBodySchema } from "@bms/shared/contracts";

import { ApiError } from "./api-error";
import {
  BATCH_TEMPLATE_EXCLUSION,
  batchCapProblem,
  batchEligibility,
  batchRefusals,
  calcPointDraftFromConfig,
  calcPointDraftFromFields,
  calcPointDraftProblems,
  draftToCalcPointBody,
  emptyCalcPointDraft,
  formulaPointsFor,
  knownRefsFor,
  standaloneConfigFor,
  type CalcPointDraft,
} from "./calc-point-draft";

/**
 * `F4.311` PR 6a — `calc-point-draft.ts`'s rules, one exported function per
 * claim; `calc-point-draft.test.ts` is the Vitest entry point (ADR 0014).
 */

const ROWS = [
  { pointKey: "kw", sourceKind: "measured" as const },
  { pointKey: "kwh", sourceKind: "computed" as const },
];

function draft(patch: Partial<CalcPointDraft> = {}): CalcPointDraft {
  return {
    ...emptyCalcPointDraft("pf"),
    formula: "{kw} * 2",
    calcIntervalSeconds: "300",
    maxInputAgeSeconds: "600",
    ...patch,
  };
}

export function aNewDraftOpensOnAGrammarAndATriggerNeverOnEmpty(): void {
  const empty = emptyCalcPointDraft();
  expect([empty.formulaDialect, empty.calcTrigger]).toEqual(["bms-calc-v1", "scheduled"]);
}

export function aCompleteDraftIsTheBodyTheSchemaParses(): void {
  const body = draftToCalcPointBody(draft({ backfillDays: "7" }));
  expect(calcPointSetBodySchema.parse(body)).toEqual({
    formula: "{kw} * 2",
    formulaDialect: "bms-calc-v1",
    calcTrigger: "scheduled",
    calcIntervalSeconds: 300,
    maxInputAgeSeconds: 600,
    backfillDays: 7,
  });
}

export function emptyFieldsAreAbsentButAnEmptyIntervalIsNull(): void {
  const body = draftToCalcPointBody(
    draft({ formula: "  ", maxInputAgeSeconds: "", calcIntervalSeconds: "", formulaDialect: "", calcTrigger: "" }),
  );
  expect(body).toEqual({ calcIntervalSeconds: null });
}

export function anEditOpensOnWhatThePointRuns(): void {
  const config = assetPointCalcConfigDtoSchema.parse({
    ...standaloneConfigFor("pf"),
    effective: {
      formula: "{kw}",
      formulaDialect: "bms-calc-v2",
      calcTrigger: "scheduled",
      calcIntervalSeconds: 60,
      maxInputAgeSeconds: 120,
    },
  });
  expect(calcPointDraftFromConfig(config)).toEqual({
    pointKey: "pf",
    formula: "{kw}",
    formulaDialect: "bms-calc-v2",
    calcTrigger: "scheduled",
    calcIntervalSeconds: "60",
    maxInputAgeSeconds: "120",
    backfillDays: "",
  });
}

export function fieldsRoundTripThroughTheBody(): void {
  const start = draft({ backfillDays: "14" });
  expect(calcPointDraftFromFields(draftToCalcPointBody(start), "pf")).toEqual(start);
}

export function aNonIntegerBackfillFromAFillReadsAsNone(): void {
  expect(calcPointDraftFromFields({ backfillDays: 2.5 }, "pf").backfillDays).toBe("");
}

export function knownRefsMirrorTheServersRuleThree(): void {
  expect(knownRefsFor(ROWS, "pf")).toEqual({ measured: ["kw"], all: ["kw", "kwh", "pf"] });
}

export function aCalculatedRowIsADerivedFormulaPoint(): void {
  expect(formulaPointsFor(ROWS)).toEqual([
    { pointKey: "kw", kind: "measured" },
    { pointKey: "kwh", kind: "derived" },
  ]);
}

export function aUsableDraftHasNoProblems(): void {
  expect(calcPointDraftProblems(draft(), knownRefsFor(ROWS, "pf"))).toEqual([]);
}

export function anUnknownKeyIsRefusedNamingThisAsset(): void {
  const [problem] = calcPointDraftProblems(draft({ formula: "{nope} + 1" }), knownRefsFor(ROWS, "pf"));
  expect(problem).toMatch(/It may reference only the point keys this asset declares: kw\.$/);
}

export function aMissingIntervalIsNamedWithoutAnInheritanceClause(): void {
  const problems = calcPointDraftProblems(draft({ calcIntervalSeconds: "" }), knownRefsFor(ROWS, "pf"));
  expect(problems).toEqual([
    'calcTrigger is "scheduled" but calcIntervalSeconds is unset. A scheduled formula needs an interval; set both together.',
  ]);
}

export function theStandInConfigParsesAsAStandaloneItem(): void {
  expect(assetPointCalcConfigDtoSchema.parse(standaloneConfigFor("pf")).kind).toBe("standalone");
}

export function aTemplatedAssetIsExcludedFromTheBatch(): void {
  const { eligible, excluded } = batchEligibility([
    { id: "a", templateId: null },
    { id: "b", templateId: "t1" },
  ]);
  expect([eligible.map((a) => a.id), excluded.map((a) => a.id), BATCH_TEMPLATE_EXCLUSION]).toEqual([
    ["a"],
    ["b"],
    "has a template — use its override",
  ]);
}

export function theCapSentenceAppearsOnlyAboveTheCap(): void {
  expect([batchCapProblem(CALC_POINT_BATCH_MAX_ASSETS), batchCapProblem(CALC_POINT_BATCH_MAX_ASSETS + 1)]).toEqual([
    null,
    "A calculated point can be added to at most 25 assets at once; 26 are selected.",
  ]);
}

export function theBatchRefusalBodyYieldsEveryRefusedAsset(): void {
  const body = {
    message: "Nothing was written: 2 of 3 asset(s) were refused.",
    refused: [
      { assetId: "a", assetCode: "PMP-1", reason: "first" },
      { assetId: "b", assetCode: null, reason: "second" },
    ],
  };
  expect(batchRefusals(new ApiError(JSON.stringify(body), 400))).toEqual(body.refused);
}

export function anyOtherErrorYieldsNoRefusals(): void {
  expect([
    batchRefusals(new ApiError("plain text", 400)),
    batchRefusals(new ApiError(JSON.stringify({ message: "x" }), 400)),
    batchRefusals("not an error"),
  ]).toEqual([null, null, null]);
}
