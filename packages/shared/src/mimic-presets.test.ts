import { describe, it } from "vitest";

import {
  everyPipeEndNamesANode,
  everyRoleCodeIsNonEmpty,
  presetKeysEqualTheEnumBothWays,
  waterTrainHasEightUniqueNodes,
} from "./mimic-presets.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.32 — the mimic preset definitions (ADR 0079 decision 2)", () => {
  it("declares exactly the presets the enum names", () => {
    presetKeysEqualTheEnumBothWays();
  });

  it("draws water_train as eight nodes with unique keys", () => {
    waterTrainHasEightUniqueNodes();
  });

  it("joins pipes and the sink only to declared nodes", () => {
    everyPipeEndNamesANode();
  });

  it("gives every node a role code", () => {
    everyRoleCodeIsNonEmpty();
  });
});
