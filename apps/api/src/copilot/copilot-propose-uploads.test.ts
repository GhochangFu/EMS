import { describe, it } from "vitest";

import { aLocationAdminIsRefusedTheRealUploadEntry, theRealUploadEntryStoresThePreparedBody } from "./copilot-propose-uploads.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.87 PR 6b — the real symbol upload entry (ADR 0099 Amendment 3 A3)", () => {
  it("stores the prepared body on the library path, svgText out of the hash", () => theRealUploadEntryStoresThePreparedBody());
  it("refuses a location admin by the role guard and stores nothing", () => aLocationAdminIsRefusedTheRealUploadEntry());
});
