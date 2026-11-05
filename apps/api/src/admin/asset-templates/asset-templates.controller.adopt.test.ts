import { describe, it } from "vitest";

import {
  anAdoptOverTheCapIsA400,
  theAdoptRouteCallsAdopt,
  thePreviewRouteCallsThePreview,
} from "./asset-templates.controller.adopt.spec";

/** `F4.312` — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.312 — the adoption routes", () => {
  it("answers 400 for 26 asset ids without reaching the service", () => anAdoptOverTheCapIsA400());
  it("sends adoption-preview to the preview", () => thePreviewRouteCallsThePreview());
  it("sends adopt to adopt", () => theAdoptRouteCallsAdopt());
});
