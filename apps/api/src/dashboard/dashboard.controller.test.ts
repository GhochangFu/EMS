import { describe, it } from "vitest";

import {
  loadTrendMalformedOrganizationIdIsABadRequest,
  loadTrendNarrowsByOrganizationId,
  loadTrendWithoutOrganizationIdReadsTheReadableSet,
} from "./dashboard.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("dashboard.controller load-trend", () => {
  it("narrows by organizationId through readableAssetIdsInOrganization", async () => {
    await loadTrendNarrowsByOrganizationId();
  });

  it("reads the readable set when organizationId is absent", async () => {
    await loadTrendWithoutOrganizationIdReadsTheReadableSet();
  });

  it("answers a malformed organizationId with 400 before access control", async () => {
    await loadTrendMalformedOrganizationIdIsABadRequest();
  });
});
