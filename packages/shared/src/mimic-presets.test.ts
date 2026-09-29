import { describe, it } from "vitest";

import {
  aSinkNamesANode,
  environmentMonitoringHasNoPipes,
  everyNodeKeyIsALayoutNodeKey,
  everyPipeEndNamesANode,
  everyPresetsNodeKeysAreUnique,
  everyRoleCodeIsLowercase,
  everyRoleCodeIsNonEmpty,
  onlyWaterTrainHasASink,
  presetKeysEqualTheEnumBothWays,
  presetNodeCountsAreThePlanTable,
  waterTrainHasEightUniqueNodes,
} from "./mimic-presets.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.32 / F3.32d — the mimic preset definitions (ADR 0079 decision 2, ADR 0082 decision 3)", () => {
  it("declares exactly the presets the enum names", () => {
    presetKeysEqualTheEnumBothWays();
  });

  it("draws water_train as eight nodes with unique keys", () => {
    waterTrainHasEightUniqueNodes();
  });

  it("uses no node key twice in any preset", () => {
    everyPresetsNodeKeysAreUnique();
  });

  it("spells every node key as a layout node key", () => {
    everyNodeKeyIsALayoutNodeKey();
  });

  it("joins pipes only to declared nodes", () => {
    everyPipeEndNamesANode();
  });

  it("puts a sink, where there is one, after a declared node", () => {
    aSinkNamesANode();
  });

  it("gives a sink to water_train alone", () => {
    onlyWaterTrainHasASink();
  });

  it("gives every node a role code", () => {
    everyRoleCodeIsNonEmpty();
  });

  it("spells every role code in lowercase", () => {
    everyRoleCodeIsLowercase();
  });

  it("draws environment_monitoring with no pipes", () => {
    environmentMonitoringHasNoPipes();
  });

  it("draws 8, 7, 5, 6, 4, 4 and 5 nodes, in enum order", () => {
    presetNodeCountsAreThePlanTable();
  });
});
