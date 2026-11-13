import { describe, it } from "vitest";

import {
  runBodyTest,
  runCodePointTest,
  runExtendCloseTest,
  runItemTest,
  runMaxMsTest,
  runTargetKindTest,
  runTargetUnionTest,
} from "./maintenance-windows.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.359 — the maintenance-window contracts (ADR 0131)", () => {
  it("caps a window at 7 days", () => {
    runMaxMsTest();
  });

  it("the target is a discriminated union of strict single-id objects", () => {
    runTargetUnionTest();
  });

  it("the create body enforces reason, targets and strictness", () => {
    runBodyTest();
  });

  it("counts the reason in code points, as the database CHECK does", () => {
    runCodePointTest();
  });

  it("the extend and close bodies", () => {
    runExtendCloseTest();
  });

  it("the item and list response", () => {
    runItemTest();
  });

  it("the item's target kind is the union's discriminator", () => {
    runTargetKindTest();
  });
});
