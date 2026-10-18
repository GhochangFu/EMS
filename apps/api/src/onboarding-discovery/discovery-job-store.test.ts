import { describe, it } from "vitest";

import { assertAuditRowShape, assertDraftWriteReplacesOnlyDiscovery } from "./discovery-job-store.spec";

/** `F3.24b` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F3.24b — the discovery job store", () => {
  it("replaces draft._discovery only, with jsonb_set", () => assertDraftWriteReplacesOnlyDiscovery());
  it("writes the audit row with the organization and no actor", () => assertAuditRowShape());
});
