import { describe, it } from "vitest";

import * as spec from "./mimic-layouts.controller.spec";

/** `F4.308` (plan T3) — Vitest entry point for the preview route at the controller. Assertions in the `.spec` (ADR 0014). */
describe("F4.308 — MimicLayoutsController preview route", () => {
  it("K1 the handler is GET :id/preview", () => {
    spec.previewRouteIsGetIdPreview();
  });
  it("K2 a missing assetGroupId is a 400 before the service", spec.missingGroupIs400);
  it("K3 a non-UUID assetGroupId is a 400 before the service", spec.nonUuidGroupIs400);
  it("K4 an extra query key is a 400 before the service", spec.extraQueryKeyIs400);
  it("K5 a bad :id is a 400 before the service", spec.badLayoutIdIs400);
  it("K6 a good request reaches the preview service once", spec.goodRequestReachesThePreviewOnce);
});
