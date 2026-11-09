import { describe, it } from "vitest";

import {
  mimicConfigParsesTheLayoutArm,
  mimicConfigParsesThePresetArm,
  mimicConfigRefusesALayoutArmWithoutLayoutId,
  mimicConfigRefusesANonUuidLayoutId,
  mimicConfigRefusesAPresetSourceCarryingALayoutId,
  mimicConfigRefusesAnUppercaseLayoutId,
  mimicPresetVocabularyIsTheSevenDomainPresets,
  motionParsesOnBothArms,
  motionRefusesANonBoolean,
} from "./mimic-config.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.32c — the mimic widget config, both arms (ADR 0081)", () => {
  it("parses the preset arm", () => {
    mimicConfigParsesThePresetArm();
  });

  it("parses the layout arm", () => {
    mimicConfigParsesTheLayoutArm();
  });

  it("refuses a layout arm without layoutId", () => {
    mimicConfigRefusesALayoutArmWithoutLayoutId();
  });

  it("refuses a layout arm whose layoutId is not a uuid", () => {
    mimicConfigRefusesANonUuidLayoutId();
  });

  it("refuses a layout arm whose layoutId is uppercase", () => {
    mimicConfigRefusesAnUppercaseLayoutId();
  });

  it("refuses source preset carrying a layoutId and no preset", () => {
    mimicConfigRefusesAPresetSourceCarryingALayoutId();
  });

  it("keeps the preset vocabulary at the seven domain presets, water_train first (ADR 0082)", () => {
    mimicPresetVocabularyIsTheSevenDomainPresets();
  });
});

describe("F4.344 — the per-widget glyph motion switch (ADR 0120 decision 5)", () => {
  it("parses motion false, true and absent on both arms", () => {
    motionParsesOnBothArms();
  });
  it("refuses a non-boolean motion on both arms", () => {
    motionRefusesANonBoolean();
  });
});
