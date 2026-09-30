import { describe, it } from "vitest";

import * as spec from "./svg-symbol-parser.spec";

/** `F3.32f` slice 3 U2 — Vitest entry point for the SVG upload parser. Assertions live in the sibling
 * `.spec` (ADR 0014); one `it()` per claim. */
describe("F3.32f — parseSvgSymbol refuses", () => {
  it("a DOCTYPE", () => spec.runDoctypeIsRefused());
  it("an undefined entity", () => spec.runUndefinedEntityIsRefused());
  it("a processing instruction", () => spec.runProcessingInstructionIsRefused());
  it("a CDATA section", () => spec.runCdataIsRefused());
  it("script", () => spec.runScriptIsRefused());
  it("a style element", () => spec.runStyleElementIsRefused());
  it("use", () => spec.runUseIsRefused());
  it("image", () => spec.runImageIsRefused());
  it("foreignObject", () => spec.runForeignObjectIsRefused());
  it("a", () => spec.runAnchorIsRefused());
  it("text", () => spec.runTextElementIsRefused());
  it("a gradient inside defs", () => spec.runGradientInsideDefsIsRefused());
  it("filter", () => spec.runFilterIsRefused());
  it("an unknown element", () => spec.runUnknownElementIsRefused());
  it("a hostile element name, capped and stripped in the message", () => spec.runARefusedElementNameIsCappedAndStripped());
  it("non-whitespace text", () => spec.runNonWhitespaceTextIsRefused());
  it("a root that is not svg", () => spec.runARootThatIsNotSvgIsRefused());
  it("a missing viewBox", () => spec.runAMissingViewBoxIsRefused());
  it("a viewBox of three numbers", () => spec.runAThreeNumberViewBoxIsRefused());
  it("a number with a unit", () => spec.runANumberWithAUnitIsRefused());
  it("a number in px", () => spec.runANumberWithPxIsRefused());
  it("path data outside the grammar", () => spec.runPathDataOutsideTheGrammarIsRefused());
  it("path data over 8192 characters", () => spec.runPathDataOverTheBoundIsRefused());
  it("a shape transform with url(", () => spec.runATransformWithAUrlIsRefused());
  it("a group transform with url(", () => spec.runAGroupTransformWithAUrlIsRefused());
  it("201 shapes", () => spec.runMoreThan200ShapesIsRefused());
  it("a file that draws nothing", () => spec.runAFileThatDrawsNothingIsRefused());
  it("malformed XML", () => spec.runMalformedXmlIsRefused());
  it("two roots", () => spec.runTwoRootsAreRefused());
  it("a nested svg", () => spec.runANestedSvgIsRefused());
  it("an element inside a shape", () => spec.runAnElementInsideAShapeIsRefused());
  it("an empty file", () => spec.runAnEmptyFileIsRefused());
});

describe("F3.32f — parseSvgSymbol drops, never stores", () => {
  it("every attribute outside the allowlist", () => spec.runDroppedAttributesNeverReachTheShapes());
  it("positive control: the allowlist assertion refuses a planted key", () =>
    spec.runTheAllowlistAssertionRefusesAPlantedKey());
  it("sodipodi, inkscape, title, desc, metadata and empty defs", () => spec.runEditorMetadataIsDropped());
});

describe("F3.32f — parseSvgSymbol geometry", () => {
  it("accepts 200 shapes", () => spec.run200ShapesIsAccepted());
  it("pushes nested g transforms down, outermost first", () => spec.runGroupTransformIsPushedDownOuterFirst());
  it("parses an Inkscape-shaped file", () => spec.runAnInkscapeFileParses());
  it("answers the viewBox as a tuple of numbers", () => spec.runTheViewBoxIsATupleOfNumbers());
  it("keeps the tag order", () => spec.runTagOrderIsKept());
  it("accepts &amp; in an attribute value", () => spec.runAnAmpersandEntityInAnAttributeIsAccepted());
  it("normalises a widely-spaced transform", () => spec.runATransformIsNormalised());
});

describe("F3.32f — parseSvgSymbol review fixes", () => {
  it("refuses a 64 KiB number attribute at once", () => spec.runA64KiBNumberAttributeIsRefusedFast());
  it("refuses a 64 KiB viewBox number at once", () => spec.runA64KiBViewBoxNumberIsRefusedFast());
  it("refuses a six-long-number matrix at once", () => spec.runALongMatrixTransformIsRefusedFast());
  it("parses exponents in d and cx", () => spec.runExponentsParse());
  it("refuses a script inside metadata", () => spec.runAScriptInsideMetadataIsRefused());
  it("refuses a style inside a sodipodi element", () => spec.runAStyleInsideSodipodiIsRefused());
});
