import { describe, it } from "vitest";

import {
  aMixedBatchUpsertsAllAndNotifiesOnlyLiveRows,
  aRowAheadOfNowIsNotified,
  aRowJustInsideTheWindowIsNotified,
  aRowJustOutsideTheWindowIsWrittenNotNotified,
  anAllLateBatchCommitsAndSendsNoNotify,
  rowsNotNotifiedIsTheCount,
} from "./normaliser-notify-window.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E7.2 — writeResolved notifies only rows inside the live window (ADR 0123 decision 10)", () => {
  it("notifies a row 4 m 59 s old", async () => {
    await aRowJustInsideTheWindowIsNotified();
  });

  it("writes a row 5 m 01 s old and does not notify it", async () => {
    await aRowJustOutsideTheWindowIsWrittenNotNotified();
  });

  it("upserts a whole mixed batch and notifies only its live rows", async () => {
    await aMixedBatchUpsertsAllAndNotifiesOnlyLiveRows();
  });

  it("commits an all-late batch and sends no pg_notify", async () => {
    await anAllLateBatchCommitsAndSendsNoNotify();
  });

  it("notifies a row 30 s ahead of now", async () => {
    await aRowAheadOfNowIsNotified();
  });

  it("reports rowsNotNotified as the count held back", async () => {
    await rowsNotNotifiedIsTheCount();
  });
});
