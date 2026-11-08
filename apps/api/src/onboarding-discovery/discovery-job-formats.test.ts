import { describe, it } from "vitest";

import {
  anUnknownChosenCodeStillRuns,
  theChosenFormatReachesTheCatalogRead,
  theSkipReasonsAreStoredAndAudited,
} from "./discovery-job-formats.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.334 — the discovery job reads the payload format catalog (ADR 0116 decision 8)", () => {
  it("F1 passes the draft RTU's payloadFormat as the chosen code", async () => theChosenFormatReachesTheCatalogRead());
  it("F2 still runs for a chosen code the catalog does not hold", async () => anUnknownChosenCodeStillRuns());
  it("F3 stores and audits skippedReasons; logs an invalid row by code", async () => theSkipReasonsAreStoredAndAudited());
});
