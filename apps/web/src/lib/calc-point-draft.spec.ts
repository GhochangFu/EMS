import { expect } from "vitest";
import { CALC_POINT_BATCH_MAX_ASSETS } from "@bms/shared";
import type { AssetPointCalcConfigDto, CalcBackfillRunDto } from "@bms/shared";
import { assetPointCalcConfigDtoSchema, calcPointSetBodySchema } from "@bms/shared/contracts";

import { ApiError } from "./api-error";
import {
  BACKFILL_POLL_MS,
  BATCH_TEMPLATE_EXCLUSION,
  backfillPollInterval,
  backfillProgressLabel,
  batchCapProblem,
  batchEligibility,
  batchRefusals,
  calcPointDraftChanged,
  calcPointDraftFromConfig,
  calcPointDraftFromFields,
  calcPointDraftProblems,
  draftDialect,
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

export function theDialectIsTheDraftsKnownGrammarElseTheDefault(): void {
  expect([draftDialect(draft({ formulaDialect: "bms-calc-v2" })), draftDialect(draft({ formulaDialect: "" }))]).toEqual([
    "bms-calc-v2",
    "bms-calc-v1",
  ]);
}

export function aDraftEqualToItsStartIsUnchanged(): void {
  expect(calcPointDraftChanged(draft(), draft())).toBe(false);
}

export function aFormulaOnlyEditIsAChange(): void {
  expect(calcPointDraftChanged(draft({ formula: "{kw} * 3" }), draft())).toBe(true);
}

// ---- `F4.311` PR 6b — backfill progress ------------------------------------

/**
 * A 31-day run asked for at 2026-11-01T00:05Z: its window starts 31 days
 * before. `createdAt` is far from `fromAt` on purpose, so a count taken from
 * the wrong one cannot pass.
 */
function run(patch: Partial<CalcBackfillRunDto> = {}): CalcBackfillRunDto {
  return {
    id: "run-1",
    status: "running",
    fromAt: "2026-10-01T00:00:00.000Z",
    toAt: "2026-11-01T00:00:00.000Z",
    doneThrough: "2026-10-04T00:00:00.000Z",
    writtenRows: 12480,
    error: null,
    createdAt: "2026-11-01T00:05:00.000Z",
    finishedAt: null,
    ...patch,
  };
}

export function aRunNotYetStartedIsQueued(): void {
  expect(backfillProgressLabel(run({ status: "queued", doneThrough: null, writtenRows: 0 }))).toBe("Backfill: queued");
}

export function aRunningRunWithNoBucketStoredYetIsQueued(): void {
  expect(backfillProgressLabel(run({ doneThrough: null, writtenRows: 0 }))).toBe("Backfill: queued");
}

export function aRunningRunCountsDaysFromItsWindowStartAndItsRows(): void {
  expect(backfillProgressLabel(run())).toBe("Backfill: 3 of 31 days, 12,480 rows");
}

export function aPartDayCountsOnlyTheWholeDaysStored(): void {
  expect(backfillProgressLabel(run({ doneThrough: "2026-10-04T23:00:00.000Z" }))).toBe(
    "Backfill: 3 of 31 days, 12,480 rows",
  );
}

export function oneRowIsSingular(): void {
  expect(backfillProgressLabel(run({ writtenRows: 1 }))).toBe("Backfill: 3 of 31 days, 1 row");
}

export function aDoneRunSaysDoneWithItsDaysAndRows(): void {
  expect(
    backfillProgressLabel(run({ status: "done", doneThrough: "2026-11-01T00:00:00.000Z", finishedAt: "2026-11-01T00:09:00.000Z" })),
  ).toBe("Backfill done: 31 days, 12,480 rows");
}

export function aFailedRunShowsItsStoredError(): void {
  expect(backfillProgressLabel(run({ status: "failed", error: "no worker" }))).toBe("Backfill failed: no worker");
}

export function aFailedRunWithNoStoredErrorSaysSo(): void {
  expect(backfillProgressLabel(run({ status: "failed", doneThrough: null, error: null }))).toBe(
    "Backfill failed: no reason was recorded",
  );
}

function item(backfill: CalcBackfillRunDto | null): AssetPointCalcConfigDto {
  return { ...standaloneConfigFor("pf"), backfill };
}

export function aQueuedOrRunningItemPollsEveryFiveSeconds(): void {
  expect([
    backfillPollInterval([item(null), item(run({ status: "queued", doneThrough: null }))]),
    backfillPollInterval([item(run())]),
  ]).toEqual([BACKFILL_POLL_MS, BACKFILL_POLL_MS]);
  expect(BACKFILL_POLL_MS).toBe(5000);
}

export function noActiveRunPollsNever(): void {
  expect([
    backfillPollInterval(undefined),
    backfillPollInterval([]),
    backfillPollInterval([item(null), item(run({ status: "done" })), item(run({ status: "failed", error: "x" }))]),
  ]).toEqual([false, false, false]);
}
