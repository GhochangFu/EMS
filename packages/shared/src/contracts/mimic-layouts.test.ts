import { describe, it } from "vitest";

import {
  mimicLayoutCellIsTen,
  mimicLayoutGeometryParsesAPanelWithANullSymbol,
  mimicPanelTonesAreThree,
  mimicSymbolsAreTheTwelveInOrder,
  mimicWidgetNodesParsesTheLayoutArm,
  mimicWidgetNodesParsesThePresetArm,
  mimicWidgetNodesRefusesALayoutArmWithoutLayout,
} from "./mimic-layouts.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.32c — the mimic layout contracts (ADR 0081)", () => {
  it("declares the twelve symbols in order", () => {
    mimicSymbolsAreTheTwelveInOrder();
  });

  it("declares three panel tones", () => {
    mimicPanelTonesAreThree();
  });

  it("sets one grid cell to ten pixels", () => {
    mimicLayoutCellIsTen();
  });

  it("parses a geometry holding a panel with symbol null", () => {
    mimicLayoutGeometryParsesAPanelWithANullSymbol();
  });

  it("parses the preset arm of the mimic-nodes widget union", () => {
    mimicWidgetNodesParsesThePresetArm();
  });

  it("parses the layout arm of the mimic-nodes widget union", () => {
    mimicWidgetNodesParsesTheLayoutArm();
  });

  it("refuses a layout widget arm without its layout", () => {
    mimicWidgetNodesRefusesALayoutArmWithoutLayout();
  });
});
