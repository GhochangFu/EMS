import { describe, it } from "vitest";

import {
  aBodyThatIsNotALayoutIsRefusedWithoutAThrow,
  aLayoutFillRoundTripsThroughTheCanvas,
  anUnknownPointIsLabelledByItsId,
  aPointLabelIsReadFromTheCanvas,
  aWidgetOnAnUnknownTabIsRefused,
} from "./dashboard-builder-fill.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.245 — a layout fill reaches the dashboard canvas (owner ruling 3)", () => {
  it("round-trips a layout fill through the canvas rows and tabs", () => aLayoutFillRoundTripsThroughTheCanvas());
  it("reads a point's label from the canvas", () => aPointLabelIsReadFromTheCanvas());
  it("labels a point the canvas lacks by its id", () => anUnknownPointIsLabelledByItsId());
  it("refuses a widget on a tab the fill does not have", () => aWidgetOnAnUnknownTabIsRefused());
  it("refuses a body that is not a layout without a throw", () => aBodyThatIsNotALayoutIsRefusedWithoutAThrow());
});
