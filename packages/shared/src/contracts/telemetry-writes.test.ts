import { describe, it } from "vitest";

import {
  theImportModelBodyAcceptsReject,
  theImportModelBodyRefusesIndexFour,
  theImportModelBodyRefusesIndexZero,
  theImportModelBodyRefusesOverwrite,
  thePreviewKeepsTwentyRejectedRows,
  thePreviewRefusesATwentyFirstRejectedRow,
  theReadingsModelBodyAcceptsReject,
  theReadingsModelBodyRefusesOverwrite,
  theRouteReadingsBodyStillAcceptsOverwrite,
  theRouteReadingsBodyStillRefusesSourceKind,
} from "./telemetry-writes.spec";

/** `F4.283` — Vitest entry point for the telemetry write bodies. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.283 — telemetry write bodies and the copilot model bodies (ADR 0030, Q21)", () => {
  it("the import model body accepts conflictPolicy reject", () => theImportModelBodyAcceptsReject());
  it("the import model body refuses conflictPolicy overwrite", () => theImportModelBodyRefusesOverwrite());
  it("the import model body refuses file index 0", () => theImportModelBodyRefusesIndexZero());
  it("the import model body refuses file index 4", () => theImportModelBodyRefusesIndexFour());
  it("the readings model body accepts conflictPolicy reject", () => theReadingsModelBodyAcceptsReject());
  it("the readings model body refuses conflictPolicy overwrite", () => theReadingsModelBodyRefusesOverwrite());
  it("the route's readings body still refuses sourceKind", () => theRouteReadingsBodyStillRefusesSourceKind());
  it("the route's readings body still accepts overwrite", () => theRouteReadingsBodyStillAcceptsOverwrite());
  it("the card preview keeps 20 rejected rows", () => thePreviewKeepsTwentyRejectedRows());
  it("the card preview refuses a 21st rejected row", () => thePreviewRefusesATwentyFirstRejectedRow());
});
