import { describe, it } from "vitest";

import * as spec from "./assets.controller.kpis.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.33 — GET /assets/:assetId/kpis is gated by canReadAsset (ADR 0097 decision 1)", () => {
  it("a denied asset is a 403", () => spec.deniedIsForbidden());
  it("a denied asset never reaches the service", () => spec.deniedNeverReachesTheService());
  it("a non-uuid segment is a ZodError before the guard", () => spec.nonUuidIsZodErrorBeforeTheGuard());
  it("no query applies the default 15-minute window", () => spec.noQueryAppliesTheDefaultWindow());
  it("a window at the bound is passed through", () => spec.aWindowInRangeIsPassedThrough());
  it.each(spec.REFUSED_QUERIES)("$label is a 400", ({ query }) => spec.refusedQueryIsBadRequest(query));
  it("canReadAsset precedes the service call in the handler source", () => spec.guardPrecedesTheServiceInSource());
});
