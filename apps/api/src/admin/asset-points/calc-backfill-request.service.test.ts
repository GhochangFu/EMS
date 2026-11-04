import { describe, it } from "vitest";

import {
  aBrokenCreateEnqueuesNothing,
  aBrokenCreateFailsTheRunsAlreadyCreated,
  aBrokenCreateIsRethrown,
  aBusyPointDoesNotStopTheOthers,
  aFailedReleaseDoesNotStopTheOthers,
  aFailedReleaseStillAnswers503,
  aStaleRunIsFailedBeforeTheNewRunIsCreated,
  anActiveRunIsA409,
  anEnqueueFailureIsA503,
  anUnqueuedRunIsMarkedNoWorker,
  oneJobIsEnqueuedPerRun,
  the409SaysTheFormulaWasSaved,
  theStaleReleaseSharesTheCreatesTransaction,
  theRunCoversTheLastDays,
} from "./calc-backfill-request.service.spec";

/** `F4.311` PR 5b — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). No database, no Redis. */
describe("F4.311 — starting a backfill (owner ruling 4)", () => {
  it("covers the last `days` days, ending now", () => theRunCoversTheLastDays());
  it("enqueues one job per run under the run's job id", () => oneJobIsEnqueuedPerRun());
  it("answers 409 when the point's backfill is already active", () => anActiveRunIsA409());
  it("says in the 409 that the formula was saved", () => the409SaysTheFormulaWasSaved());
  it("still starts the free points' runs in a batch", () => aBusyPointDoesNotStopTheOthers());
  it("answers 503 when no worker can be reached", () => anEnqueueFailureIsA503());
  it("marks the unqueued run failed / no worker", () => anUnqueuedRunIsMarkedNoWorker());
  it("fails a stale running run of the point before creating the new one", () =>
    aStaleRunIsFailedBeforeTheNewRunIsCreated());
  it("releases the stale run inside the create's transaction", () => theStaleReleaseSharesTheCreatesTransaction());
  it("marks the runs already created 'not started' when a later create throws", () =>
    aBrokenCreateFailsTheRunsAlreadyCreated());
  it("enqueues nothing when a create throws", () => aBrokenCreateEnqueuesNothing());
  it("rethrows a create's non-unique error", () => aBrokenCreateIsRethrown());
  it("still releases the later runs when one release throws", () => aFailedReleaseDoesNotStopTheOthers());
  it("still answers 503 when a release throws", () => aFailedReleaseStillAnswers503());
});
