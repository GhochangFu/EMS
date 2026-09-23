import { describe, it } from "vitest";

import {
  budgetRefusalWarnsOncePerSweep,
  emptyWindowRefusesWithoutARow,
  failedReadRefusesOnlyWindowHolders,
  noWindowReadsMakesNoCall,
  parameterUnsetStillBatchesWindows,
  requestsAreTheDistinctSetOfDueDefinitions,
  sparseWindowRefusesWithoutARow,
  staleInputWinsOverEmptyWindow,
  subMinuteIntervalEndsOnTheMinute,
  unsetZoneRefusesWithoutARow,
  windowReadsPresentWrite,
} from "./calc-scheduler.windows.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * Split from `calc-scheduler.v3.test.ts` for the same §4.5 reason it was
 * split from `calc-scheduler.test.ts`; the harness is shared by import. */
describe("window reads in the scheduled sweep (ADR 0070 decision 5, E4.1b)", () => {
  it("H1 both reads present → one write with delta / hours at the bucketed tick", async () => {
    await windowReadsPresentWrite();
  });

  it("H2 the owed guard: window_empty → exactly one skip and no row; the v1 sibling still writes", async () => {
    await emptyWindowRefusesWithoutARow();
  });

  it("H11 window_sparse (E4.4) → exactly one skip and no row, as window_empty; the v1 sibling still writes", async () => {
    await sparseWindowRefusesWithoutARow();
  });

  it("H3 timezone_unset → exactly one skip and no row", async () => {
    await unsetZoneRefusesWithoutARow();
  });

  it("H4 a failed window read refuses only the definitions holding a window read, with one warn", async () => {
    await failedReadRefusesOnlyWindowHolders();
  });

  it("H5 the requests are the distinct reads of the due definitions, once per sweep, a qualified read on the member asset", async () => {
    await requestsAreTheDistinctSetOfDueDefinitions();
  });

  it("H6 a stale local reading beside an empty window is stale_input", async () => {
    await staleInputWinsOverEmptyWindow();
  });

  it("H7 a parameter absent beside a window is parameter_unset, and the window batch still ran once", async () => {
    await parameterUnsetStillBatchesWindows();
  });

  it("H8 no window read anywhere → resolveReads is never called", async () => {
    await noWindowReadsMakesNoCall();
  });

  it("H9 a budget refusal is windows_unresolved per definition and one warn per distinct detail per sweep", async () => {
    await budgetRefusalWarnsOncePerSweep();
  });

  it("H10 a 10 s interval's request ends on the minute, and the host finds its answer under that key", async () => {
    await subMinuteIntervalEndsOnTheMinute();
  });
});
