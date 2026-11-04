import { describe, it } from "vitest";

import {
  aBusyPointDoesNotStopTheOthers,
  anActiveRunIsA409,
  anEnqueueFailureIsA503,
  anUnqueuedRunIsMarkedNoWorker,
  oneJobIsEnqueuedPerRun,
  the409SaysTheFormulaWasSaved,
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
});
