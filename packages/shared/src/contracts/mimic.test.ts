import { describe, it } from "vitest";

import {
  mimicHeadlinePointsIsThree,
  mimicNodeAlarmRefusesAMissingLabel,
  mimicNodeAlarmRefusesAToneOutsideTheToneSet,
  mimicNodeRefusesAMissingMemberCount,
  mimicResponseParsesAssignedAndUnassignedNodes,
  mimicResponseRefusesAnUndeclaredPreset,
} from "./mimic.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.32 — the mimic-nodes response contract (ADR 0079)", () => {
  it("parses an assigned node and an unassigned node", () => {
    mimicResponseParsesAssignedAndUnassignedNodes();
  });

  it("refuses a preset outside the closed vocabulary", () => {
    mimicResponseRefusesAnUndeclaredPreset();
  });

  it("refuses a node without memberCount", () => {
    mimicNodeRefusesAMissingMemberCount();
  });

  it("shows three headline points per node", () => {
    mimicHeadlinePointsIsThree();
  });

  it("F3.32b refuses a top alarm whose tone is outside the tone set", () => {
    mimicNodeAlarmRefusesAToneOutsideTheToneSet();
  });

  it("F3.32b refuses a top alarm without its severity label", () => {
    mimicNodeAlarmRefusesAMissingLabel();
  });
});
