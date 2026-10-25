import { describe, it } from "vitest";

import { writeReadingsInsertsExactlyTheAcceptedRows } from "./telemetry-write-validate.spec";

/** `F4.283` — Vitest entry point for the validateRows seam. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.283 — writeReadings writes what validateRows accepted (ADR 0099 Amendment 8)", () => {
  it("inserts exactly the accepted rows and reports the rejected ones", () => writeReadingsInsertsExactlyTheAcceptedRows());
});
