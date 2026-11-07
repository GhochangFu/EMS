// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  aTemplateChartShowsAColourPerPointKey,
  aTemplateTileShowsNoColour,
  choosingATemplateColourWritesItAtTheKeysPosition,
  unselectingAKeyKeepsTheOthersColours,
} from "./dashboard-widget-editor.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.325 asset-template widget editor — a colour per chart point", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a Colour select beside each selected chart key", () => aTemplateChartShowsAColourPerPointKey());
  it("shows none on a tile", () => aTemplateTileShowsNoColour());
  it("writes a chosen colour at the key's position", () => choosingATemplateColourWritesItAtTheKeysPosition());
  it("unselecting a key keeps the other keys' colours", () => unselectingAKeyKeepsTheOthersColours());
});
