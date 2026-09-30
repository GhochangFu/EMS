import { describe, it } from "vitest";

import {
  everyLibraryKeyNamesItsLibraryAndFitsSixtyFour,
  groupCodesAreTheEight,
  layoutDtoParsesOrgSymbols,
  layoutDtoRefusesAnAbsentOrgSymbols,
  libraryCodesAreTheSevenInPaletteOrder,
  mimicCoreSymbolsAreTheTwentyNineInOrder,
  mimicLayoutCellIsTen,
  mimicLayoutDtoParsesSymbolLibraries,
  mimicLayoutDtoRefusesAnUnknownLibraryCode,
  mimicLayoutGeometryParsesAPanelWithANullSymbol,
  mimicPanelTonesAreThree,
  mimicSymbolRefusalIsShort,
  mimicSymbolSchemaAcceptsAnOrgKey,
  mimicSymbolSchemaIsCoreThenEachLibraryInRegistryOrder,
  mimicSymbolSchemaRefusesOrgPlantWithNoName,
  mimicWidgetNodesParsesTheLayoutArm,
  mimicWidgetNodesParsesThePresetArm,
  mimicWidgetNodesRefusesALayoutArmWithoutLayout,
  symbolLibrariesAcceptsOrgPlant,
} from "./mimic-layouts.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.32c — the mimic layout contracts (ADR 0081)", () => {
  it("declares the twenty-nine core symbols in order", () => {
    mimicCoreSymbolsAreTheTwentyNineInOrder();
  });

  it("unions the core symbols, then each library's keys in registry order (F3.32e)", () => {
    mimicSymbolSchemaIsCoreThenEachLibraryInRegistryOrder();
  });

  it("refuses an unknown symbol with one short message (F3.32e)", () => {
    mimicSymbolRefusalIsShort();
  });

  it("names each library key by its library, within 64 characters (F3.32e)", () => {
    everyLibraryKeyNamesItsLibraryAndFitsSixtyFour();
  });

  it("declares the seven symbol libraries in palette order (F3.32e, F3.32f)", () => {
    libraryCodesAreTheSevenInPaletteOrder();
  });

  it("declares the eight palette groups (F3.32e)", () => {
    groupCodesAreTheEight();
  });

  it("parses a layout DTO's symbol libraries (F3.32e)", () => {
    mimicLayoutDtoParsesSymbolLibraries();
  });

  it("refuses a layout DTO naming an unknown library (F3.32e)", () => {
    mimicLayoutDtoRefusesAnUnknownLibraryCode();
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

  it("accepts an organization key as a node symbol (F3.32f slice 3)", () => {
    mimicSymbolSchemaAcceptsAnOrgKey();
  });

  it("refuses an organization library key as a symbol, with the short message (F3.32f slice 3)", () => {
    mimicSymbolSchemaRefusesOrgPlantWithNoName();
  });

  it("parses a layout DTO embedding orgSymbols (F3.32f slice 3)", () => {
    layoutDtoParsesOrgSymbols();
  });

  it("refuses a layout DTO or a geometry without orgSymbols (F3.32f slice 3)", () => {
    layoutDtoRefusesAnAbsentOrgSymbols();
  });

  it("accepts org.plant in symbolLibraries, and not a symbol key (F3.32f slice 3)", () => {
    symbolLibrariesAcceptsOrgPlant();
  });
});
