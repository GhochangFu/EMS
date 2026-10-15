// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import { theFlowFixtureDrawsEachUnitAndPipe, thePreviewKeepsTheCanvasRatio } from "./mimic-layout-preview.spec";

afterEach(() => {
  cleanup();
});

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042). */
describe("F3.87 PR 5 — MimicLayoutPreview", () => {
  it("draws each unit and pipe of the F3.80 flow fixture", () => theFlowFixtureDrawsEachUnitAndPipe());
  it("keeps the canvas ratio and names the drawing", () => thePreviewKeepsTheCanvasRatio());
});
