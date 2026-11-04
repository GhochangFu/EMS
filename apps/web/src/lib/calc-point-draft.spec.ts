import { expect } from "vitest";
import { BACKFILL_NO_WORKER, CALC_POINT_BATCH_MAX_ASSETS } from "@bms/shared";
import type { AssetPointCalcConfigDto, CalcBackfillRunDto } from "@bms/shared";
import { assetPointCalcConfigDtoSchema, calcPointSetBodySchema } from "@bms/shared/contracts";

import { ApiError } from "./api-error";
import {
  BACKFILL_POLL_MS,
  BACKFILL_RETRY_WINDOW_MS,
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
/** The clock every claim reads: a day after the fixture run was asked for. */
const NOW_MS = Date.parse("2026-11-02T00:00:00.000Z");

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
  expect(backfillProgressLabel(run({ status: "queued", doneThrough: null, writtenRows: 0 }), NOW_MS)).toBe("Backfill: queued");
}

export function aRunningRunWithNoBucketStoredYetIsQueued(): void {
  expect(backfillProgressLabel(run({ doneThrough: null, writtenRows: 0 }), NOW_MS)).toBe("Backfill: queued");
}

export function aRunningRunCountsDaysFromItsWindowStartAndItsRows(): void {
  expect(backfillProgressLabel(run(), NOW_MS)).toBe("Backfill: 3 of 31 days, 12,480 rows");
}

export function aPartDayCountsOnlyTheWholeDaysStored(): void {
  expect(backfillProgressLabel(run({ doneThrough: "2026-10-04T23:00:00.000Z" }), NOW_MS)).toBe(
    "Backfill: 3 of 31 days, 12,480 rows",
  );
}

export function oneRowIsSingular(): void {
  expect(backfillProgressLabel(run({ writtenRows: 1 }), NOW_MS)).toBe("Backfill: 3 of 31 days, 1 row");
}

export function aDoneRunSaysDoneWithItsDaysAndRows(): void {
  expect(
    backfillProgressLabel(run({ status: "done", doneThrough: "2026-11-01T00:00:00.000Z", finishedAt: "2026-11-01T00:09:00.000Z" }), NOW_MS),
  ).toBe("Backfill done: 31 days, 12,480 rows");
}

export function aFailedRunShowsItsStoredError(): void {
  expect(backfillProgressLabel(run({ status: "failed", error: "no worker" }), NOW_MS)).toBe("Backfill failed: no worker");
}

export function aOneDayDoneRunIsSingular(): void {
  expect(
    backfillProgressLabel(
      run({ status: "done", fromAt: "2026-10-31T00:00:00.000Z", doneThrough: "2026-11-01T00:00:00.000Z" }),
      NOW_MS,
    ),
  ).toBe("Backfill done: 1 day, 12,480 rows");
}

export function aOneDayRunningRunIsSingular(): void {
  expect(backfillProgressLabel(run({ fromAt: "2026-10-31T00:00:00.000Z", doneThrough: "2026-10-31T06:00:00.000Z" }), NOW_MS)).toBe(
    "Backfill: 0 of 1 day, 12,480 rows",
  );
}

/** A failure BullMQ may still retry (an error's name), finished `agoMs` before {@link NOW_MS}. */
function retriableFailure(agoMs: number): CalcBackfillRunDto {
  return run({ status: "failed", error: "TypeError", finishedAt: new Date(NOW_MS - agoMs).toISOString() });
}

export function aJustFailedRetriableRunSaysRetrying(): void {
  expect(backfillProgressLabel(retriableFailure(5000), NOW_MS)).toBe("Backfill failed, retrying: TypeError");
}

export function anOldFailedRetriableRunSaysFailed(): void {
  expect(backfillProgressLabel(retriableFailure(BACKFILL_RETRY_WINDOW_MS + 1000), NOW_MS)).toBe(
    "Backfill failed: TypeError",
  );
}

export function aFailedRunWithNoStoredErrorSaysSo(): void {
  expect(backfillProgressLabel(run({ status: "failed", doneThrough: null, error: null }), NOW_MS)).toBe(
    "Backfill failed: no reason was recorded",
  );
}

function item(backfill: CalcBackfillRunDto | null): AssetPointCalcConfigDto {
  return { ...standaloneConfigFor("pf"), backfill };
}

export function aQueuedOrRunningItemPollsEveryFiveSeconds(): void {
  expect([
    backfillPollInterval([item(null), item(run({ status: "queued", doneThrough: null }))], NOW_MS),
    backfillPollInterval([item(run())], NOW_MS),
  ]).toEqual([BACKFILL_POLL_MS, BACKFILL_POLL_MS]);
  expect(BACKFILL_POLL_MS).toBe(5000);
}

export function noActiveRunPollsNever(): void {
  expect([
    backfillPollInterval(undefined, NOW_MS),
    backfillPollInterval([], NOW_MS),
    backfillPollInterval(
      [
        item(null),
        item(run({ status: "done" })),
        // A failure no retry can mend, even one that just happened.
        item(run({ status: "failed", error: BACKFILL_NO_WORKER, finishedAt: new Date(NOW_MS - 1000).toISOString() })),
      ],
      NOW_MS,
    ),
  ]).toEqual([false, false, false]);
}

export function aJustFailedRetriableRunIsStillPolled(): void {
  expect(backfillPollInterval([item(retriableFailure(5000))], NOW_MS)).toBe(BACKFILL_POLL_MS);
}

export function aJustFailedRunWithNoStoredErrorIsStillPolled(): void {
  expect(
    backfillPollInterval([item(run({ status: "failed", error: null, finishedAt: new Date(NOW_MS - 5000).toISOString() }))], NOW_MS),
  ).toBe(BACKFILL_POLL_MS);
}

export function anOldFailedRetriableRunIsNotPolled(): void {
  expect(backfillPollInterval([item(retriableFailure(BACKFILL_RETRY_WINDOW_MS + 1000))], NOW_MS)).toBe(false);
}
