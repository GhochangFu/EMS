import { describe, it } from "vitest";

import {
  aFirstWriteDeletesOldRowsAndInsertsOneAttempt,
  aRetryDeletesTheFailedRowAndCountsOnTheSameDay,
  theReadsShapeTheirRows,
  theUtcDayHelpers,
} from "./findings-paragraph.store.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.9c — the findings paragraph store (ADR 0135 Amendment 8 decision 7)", () => {
  it("the UTC day helpers", () => theUtcDayHelpers());
  it("a first write deletes old rows and inserts one attempt, on conflict nothing", () =>
    aFirstWriteDeletesOldRowsAndInsertsOneAttempt());
  it("a retry deletes the failed row and counts attempts + 1 on the same UTC day", () =>
    aRetryDeletesTheFailedRowAndCountsOnTheSameDay());
  it("the reads shape their rows", () => theReadsShapeTheirRows());
});
