import { describe, it } from "vitest";

import {
  crossRowPipeRunsBetweenTheScaledSlots,
  domainPresetsAreNamedByTheirLabel,
  domainPresetsDrawEveryNode,
  domainPresetsDrawEveryPipe,
  domainPresetsDrawNoPump,
  domainPresetsDrawNoSink,
  domainPresetsDrawTheirGlyphs,
  emptyGeometryHoldsNothing,
  layoutCarriesItsOrgSymbols,
  layoutPipesJoinUnitsOnly,
  layoutScalesByTheCell,
  layoutUnitsTakeTheirPanel,
  presetCarriesNoOrgSymbols,
  presetPanelsAreTheF332bFrames,
  presetPipesPumpAndSinkAreTheF332bDrawing,
  presetUnitsAreTheF332bSlots,
  routerEqualsPipePathForSlots,
  sameRowPipeRunsFromTheUpstreamSymbol,
  unitScaleFitsTheSlotUniformly,
} from "./mimic-geometry.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.32c U4 — mimic geometry", () => {
  it("G1 the preset's units are the F3.32b slots, in preset order", () => {
    presetUnitsAreTheF332bSlots();
  });
  it("G2 the preset's viewBox and panel frames are the F3.32b ones", () => {
    presetPanelsAreTheF332bFrames();
  });
  it("G3 the preset's pipes, pump and sink are the F3.32b drawing", () => {
    presetPipesPumpAndSinkAreTheF332bDrawing();
  });
  it("G4 a unit's slot scales uniformly into its box, centred", () => {
    unitScaleFitsTheSlotUniformly();
  });
  it("G5 a same-row pipe runs from the upstream symbol's height, both directions", () => {
    sameRowPipeRunsFromTheUpstreamSymbol();
  });
  it("G6 a cross-row pipe runs between the scaled slots, both directions", () => {
    crossRowPipeRunsBetweenTheScaledSlots();
  });
  it("G7 for two slots the router equals pipePath", () => {
    routerEqualsPipePathForSlots();
  });
  it("G8 a layout scales by the cell and draws in z order", () => {
    layoutScalesByTheCell();
  });
  it("G9 a layout unit takes the panel holding its centre", () => {
    layoutUnitsTakeTheirPanel();
  });
  it("G10 a layout's pipes join units only", () => {
    layoutPipesJoinUnitsOnly();
  });
  it("G11 the empty geometry draws nothing", () => {
    emptyGeometryHoldsNothing();
  });
  it("G12 each domain preset draws one unit per preset node", () => {
    domainPresetsDrawEveryNode();
  });
  it("G13 each domain preset draws every preset pipe", () => {
    domainPresetsDrawEveryPipe();
  });
  it("G14 a domain preset has no sink", () => {
    domainPresetsDrawNoSink();
  });
  it("G15 a domain preset draws no pump", () => {
    domainPresetsDrawNoPump();
  });
  it("G16 a domain preset is named by its label", () => {
    domainPresetsAreNamedByTheirLabel();
  });
  it("G17 a domain preset's units draw their glyphs", () => {
    domainPresetsDrawTheirGlyphs();
  });
  it("G18 a layout carries the organization symbols it embeds (F3.32f slice 3)", () => {
    layoutCarriesItsOrgSymbols();
  });
  it("G19 a preset carries no organization symbol (F3.32f slice 3)", () => {
    presetCarriesNoOrgSymbols();
  });
});
