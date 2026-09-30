import { describe, it } from "vitest";

import * as spec from "./mimic-layouts.schema.spec";

/** `F3.32c` U2 — Vitest entry point for the mimic layout write bodies. Assertions live in the
 * sibling `.spec` (ADR 0014); one `it()` per claim. */
describe("F3.32c — the mimic layout write bodies", () => {
  it("accepts a valid create body", () => spec.acceptsAValidCreateBody());
  it("accepts a valid PUT body with a version", () => spec.acceptsAValidPutBodyWithAVersion());
  it("refuses an unknown body key", () => spec.refusesAnUnknownBodyKey());
  it("refuses an unknown node key", () => spec.refusesAnUnknownNodeKey());
  it("refuses a unit without a symbol", () => spec.refusesAUnitWithoutASymbol());
  it("refuses a unit with a tone", () => spec.refusesAUnitWithATone());
  it("refuses a panel with a symbol", () => spec.refusesAPanelWithASymbol());
  it("refuses a panel with a role", () => spec.refusesAPanelWithARole());
  it("refuses a panel without a tone", () => spec.refusesAPanelWithoutATone());
  it("refuses a label with a tone", () => spec.refusesALabelWithATone());
  it("refuses an unknown symbol", () => spec.refusesAnUnknownSymbol());
  it("refuses a node key outside the charset", () => spec.refusesANodeKeyOutsideTheCharset());
  it("refuses a duplicate node key", () => spec.refusesADuplicateNodeKey());
  it("refuses a node outside the layout's canvas", () => spec.refusesANodeOutsideTheCanvas());
  it("accepts a node that touches the canvas edge", () => spec.acceptsANodeTouchingTheCanvasEdge());
  it("refuses a pipe to a panel", () => spec.refusesAPipeToAPanel());
  it("refuses a pipe to an unknown key", () => spec.refusesAPipeToAnUnknownKey());
  it("refuses a pipe from a unit to itself", () => spec.refusesAPipeFromAUnitToItself());
  it("refuses a duplicate pipe", () => spec.refusesADuplicatePipe());
  it("refuses a canvas wider than the grid", () => spec.refusesACanvasWiderThanTheGrid());
  it("refuses more nodes than the bound", () => spec.refusesMoreNodesThanTheBound());
  it("refuses an unsafe slug", () => spec.refusesAnUnsafeSlug());
  it("refuses a PUT body without a version", () => spec.refusesAPutBodyWithoutAVersion());
  it("refuses a PUT body with version 0", () => spec.refusesAPutBodyWithVersionZero());
  it("refuses a PUT body that names an organization", () => spec.refusesAPutBodyThatNamesAnOrganization());
  it("F3.32e defaults an absent library list to core", () => spec.defaultsAnAbsentLibraryListToCore());
  it("F3.32e defaults an absent library list to core on a PUT", () => spec.defaultsAnAbsentLibraryListToCoreOnAPut());
  it("F3.32e refuses a library listed twice", () => spec.refusesALibraryListedTwice());
  it("F3.32e refuses an empty library list", () => spec.refusesAnEmptyLibraryList());
  it("F3.32e refuses an unknown library code", () => spec.refusesAnUnknownLibraryCode());
  it("F3.32e refuses a unit from a library the layout did not choose", () =>
    spec.refusesAUnitFromALibraryTheLayoutDidNotChoose());
  it("F3.32e refuses a PUT unit from a library the layout did not choose", () =>
    spec.refusesAPutUnitFromALibraryTheLayoutDidNotChoose());
  it("F3.32e accepts a unit from a chosen library", () => spec.acceptsAUnitFromAChosenLibrary());
  it("F3.32e accepts a layout without core", () => spec.acceptsALayoutWithoutCore());
  it("F3.32e refuses a key in no library", () => spec.refusesAKeyInNoLibrary());
  it("F3.32f accepts an org symbol from a chosen org library", () => spec.acceptsAnOrgSymbolFromAChosenOrgLibrary());
  it("F3.32f refuses an org symbol from an org library the layout did not choose", () =>
    spec.refusesAnOrgSymbolFromAnOrgLibraryTheLayoutDidNotChoose());
  it("F3.32f refuses an org library listed twice", () => spec.refusesAnOrgLibraryListedTwice());
  it("F3.32f refuses an org symbol key with an uppercase code", () => spec.refusesAnOrgSymbolKeyWithAnUppercaseCode());
  it("F3.32f refuses an org library key with an uppercase code", () =>
    spec.refusesAnOrgLibraryKeyWithAnUppercaseCode());
});
