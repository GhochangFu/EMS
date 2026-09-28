import { describe, it } from "vitest";

import {
  mimicConfigParsesTheLayoutArm,
  mimicConfigParsesThePresetArm,
  mimicConfigRefusesALayoutArmWithoutLayoutId,
  mimicConfigRefusesANonUuidLayoutId,
  mimicConfigRefusesAPresetSourceCarryingALayoutId,
  mimicPresetVocabularyIsWaterTrainAlone,
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

  it("refuses source preset carrying a layoutId and no preset", () => {
    mimicConfigRefusesAPresetSourceCarryingALayoutId();
  });

  it("keeps the preset vocabulary at water_train alone", () => {
    mimicPresetVocabularyIsWaterTrainAlone();
  });
});
