// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  alarmNodeIsAlarm,
  assignedNodeShowsItsAssetCode,
  atMostThreeValueRows,
  badgeCountsTheOtherMembers,
  drawsEightNodesInPresetOrder,
  drawsEveryPipeAndTheSink,
  loadingDrawsNoNodes,
  unassignedNodeSaysNotAssigned,
} from "./mimic-widget.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F3.32 U4 — MimicWidget", () => {
  afterEach(() => {
    cleanup();
  });

  it("W1 draws eight nodes in the preset's order", () => {
    drawsEightNodesInPresetOrder();
  });
  it("W2 an unassigned node says Not assigned and is dimmed", () => {
    unassignedNodeSaysNotAssigned();
  });
  it("W2b an assigned node shows its asset code and is not dimmed", () => {
    assignedNodeShowsItsAssetCode();
  });
  it("W3 three members read +2; one member reads no badge", () => {
    badgeCountsTheOtherMembers();
  });
  it("W4 an alarmed fresh node is alarm; a quiet fresh one live; a silent one none", () => {
    alarmNodeIsAlarm();
  });
  it("W5 draws every preset pipe and the Discharge sink once", () => {
    drawsEveryPipeAndTheSink();
  });
  it("W6 at most three value rows, with the live value", () => {
    atMostThreeValueRows();
  });
  it("W7 loading draws no node", () => {
    loadingDrawsNoNodes();
  });
});
