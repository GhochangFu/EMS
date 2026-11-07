import { describe, it } from "vitest";

import {
  assertTheBulkRoutesReachTheService,
  assertThePerSiteBodyIsStrict,
  assertThePerSiteRoutesReachTheService,
  assertTheReplaceRoutesAreDeclared,
} from "./site-layout-replace-routes.spec";

/** `F4.320` PR 2 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.320 PR 2 — the Replace and preview routes", () => {
  it("declares each route on its handler", () => assertTheReplaceRoutesAreDeclared());
  it("passes the per-site id and parsed body to the service", async () => {
    await assertThePerSiteRoutesReachTheService();
  });
  it("refuses an unknown body key and a bad id with 400 before the service", async () => {
    await assertThePerSiteBodyIsStrict();
  });
  it("passes the bulk template id to the service", async () => {
    await assertTheBulkRoutesReachTheService();
  });
});
