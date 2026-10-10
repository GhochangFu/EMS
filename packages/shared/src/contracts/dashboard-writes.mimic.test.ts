import { describe, it } from "vitest";

import {
  acceptsTheLayoutArm,
  refusesALayoutArmCarryingAPreset,
  refusesALayoutArmWhoseIdIsNotAUuid,
  refusesALayoutArmWhoseIdIsUppercase,
  refusesALayoutArmWithoutALayoutId,
  refusesAnUnknownSource,
  runDashboardsSchemaMimicSourceShapeTests,
} from "./dashboard-writes.mimic.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.32 — the mimic widget binds nothing (ADR 0079)", () => {
  it("accepts an unbound mimic, refuses a point, and refuses an unrecognized config key", () => {
    runDashboardsSchemaMimicSourceShapeTests();
  });
});

/** `F3.32c` / ADR 0081 decision 5 — the layout arm. One `it()` per claim. */
describe("F3.32c — the mimic config's layout arm", () => {
  it("accepts a layout arm naming a uuid", () => {
    acceptsTheLayoutArm();
  });

  it("refuses a layout arm without a layoutId", () => {
    refusesALayoutArmWithoutALayoutId();
  });

  it("refuses a layout arm whose layoutId is not a uuid", () => {
    refusesALayoutArmWhoseIdIsNotAUuid();
  });

  it("refuses a layout arm whose layoutId is uppercase", () => {
    refusesALayoutArmWhoseIdIsUppercase();
  });

  it("refuses a layout arm carrying a preset key (the layout arm is strict)", () => {
    refusesALayoutArmCarryingAPreset();
  });

  it("refuses a source neither arm declares", () => {
    refusesAnUnknownSource();
  });
});
