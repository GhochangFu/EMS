// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  alarmedNodeDrawsOneCallout,
  alarmNodeIsAlarm,
  everyNodeDrawsItsSymbol,
  flowRunsFromFreshNodes,
  staleNodesDoNotFlow,
  longMessageIsCutWithFullTitle,
  calloutTextIsClippedToItsBox,
  accessibleNameNamesTheAlarmedUnit,
  accessibleNameOfAQuietPlantNamesNoUnit,
  panelsHoldTheirTrains,
  quietNodesDrawNoCallout,
  assignedNodeShowsItsAssetCode,
  atMostThreeValueRows,
  badgeCountsTheOtherMembers,
  drawsEightNodesInPresetOrder,
  drawsEveryPipeAndTheSink,
  loadingDrawsNoNodes,
  aNodeWithNoMemberSaysNoAssetAtThisSite,
  aNoAssetNodeDrawsANeutralSolidFrame,
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
  it("W2 a node with no member says No asset at this site and is dimmed", () => {
    aNodeWithNoMemberSaysNoAssetAtThisSite();
  });
  it("W2c a no-asset node draws a neutral, solid frame", () => {
    aNoAssetNodeDrawsANeutralSolidFrame();
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

describe("F3.32b — MimicWidget, the reference look (ADR 0079 Amendment 2)", () => {
  afterEach(() => {
    cleanup();
  });

  it("C1 a node with topAlarm draws one callout in its vocabulary tone and label", () => {
    alarmedNodeDrawsOneCallout();
  });
  it("C2 a node without topAlarm draws no callout", () => {
    quietNodesDrawNoCallout();
  });
  it("P1 three panels hold their trains' nodes", () => {
    panelsHoldTheirTrains();
  });
  it("G1 every node draws its mapped symbol; the tank fills to its level", () => {
    everyNodeDrawsItsSymbol();
  });
  it("C3 a 60-character message shows at most 21 characters, the full text in its title", () => {
    longMessageIsCutWithFullTitle();
  });
  it("C4 the callout text is clipped to its box", () => {
    calloutTextIsClippedToItsBox();
  });
  it("X1 the accessible name names the alarmed unit, its severity label and full message", () => {
    accessibleNameNamesTheAlarmedUnit();
  });
  it("X2 a quiet plant's accessible name names no unit", () => {
    accessibleNameOfAQuietPlantNamesNoUnit();
  });
  it("F1 the flow dash rides pipes out of a unit with fresh data, alarm included", () => {
    flowRunsFromFreshNodes();
  });
  it("F2 an alarm unit with an old reading, and a stale unit, do not flow", () => {
    staleNodesDoNotFlow();
  });
});
