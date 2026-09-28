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
});
