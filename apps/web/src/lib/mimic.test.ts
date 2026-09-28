import { describe, it } from "vitest";

import {
  alarmWinsOverFreshness,
  calloutTextIsCutByCodePoint,
  glyphMapCoversEveryPresetNode,
  levelFractionClamps,
  levelPointNeedsLevelAndPercent,
  panelBoxHoldsTheSink,
  panelFramesFitAndDoNotOverlap,
  panelsPartitionThePresetNodes,
  pumpSitsMidGap,
  severityToneFromTheVocabularyTone,
  calloutTextDefaultCutIsTwenty,
  alarmedFreshNodeFlows,
  alarmedStaleNodeDoesNotFlow,
  onlyFreshStatusesFlow,
  ariaLabelNamesEveryAlarmedUnit,
  atMostThreeValueRows,
  badgeCountsTheHiddenMembers,
  crossRowPipeLandsOnTheTopCentre,
  freshNodeIsLive,
  layoutKeysMatchPresetKeys,
  noWidgetIsNoView,
  nodesFitAndDoNotOverlap,
  oldNodeIsStale,
  sameRowPipeRunsEdgeToEdge,
  silentNodeIsNone,
  unassignedWinsOverAlarm,
  viewHoldsEachAssetOnce,
  viewHoldsOnlyAssignedAssets,
} from "./mimic.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.32 U4 — the plant mimic's pure half", () => {
  it("M1 the synthetic view holds the assigned assets only, in node order", () => {
    viewHoldsOnlyAssignedAssets();
  });
  it("M1b one asset under two nodes is tracked once", () => {
    viewHoldsEachAssetOnce();
  });
  it("M1c no widget entry is no view", () => {
    noWidgetIsNoView();
  });
  it("M2a an unassigned node is unassigned even with alarms", () => {
    unassignedWinsOverAlarm();
  });
  it("M2b an alarmed node is alarm although fresh", () => {
    alarmWinsOverFreshness();
  });
  it("M2c a fresh node with no alarm is live", () => {
    freshNodeIsLive();
  });
  it("M2d an old node with no alarm is stale", () => {
    oldNodeIsStale();
  });
  it("M2e a node with no sample is none", () => {
    silentNodeIsNone();
  });
  it("M3 a node shows at most three value rows", () => {
    atMostThreeValueRows();
  });
  it("M4a layout keys equal preset keys", () => {
    layoutKeysMatchPresetKeys();
  });
  it("M4b nodes fit the viewBox and do not overlap", () => {
    nodesFitAndDoNotOverlap();
  });
  it("M5 the badge counts the hidden members", () => {
    badgeCountsTheHiddenMembers();
  });
  it("M6a a same-row pipe runs edge to edge", () => {
    sameRowPipeRunsEdgeToEdge();
  });
  it("M6b a cross-row pipe lands on the top centre", () => {
    crossRowPipeLandsOnTheTopCentre();
  });
  it("M7 every preset node sits in exactly one panel", () => {
    panelsPartitionThePresetNodes();
  });
  it("M7b panel frames fit the viewBox and do not overlap", () => {
    panelFramesFitAndDoNotOverlap();
  });
  it("M7c the sink's panel holds the sink; no node, no frame", () => {
    panelBoxHoldsTheSink();
  });
  it("M8 the symbol map covers every preset node", () => {
    glyphMapCoversEveryPresetNode();
  });
  it("M9a a level point is a level key in %", () => {
    levelPointNeedsLevelAndPercent();
  });
  it("M9b the fill fraction clamps", () => {
    levelFractionClamps();
  });
  it("M10 the callout colour is the vocabulary tone", () => {
    severityToneFromTheVocabularyTone();
  });
  it("M11 a callout line is cut by code point", () => {
    calloutTextIsCutByCodePoint();
  });
  it("M11b a 60-character line shows at most 20 characters", () => {
    calloutTextDefaultCutIsTwenty();
  });
  it("M12 a pump sits mid-gap on a same-row pipe", () => {
    pumpSitsMidGap();
  });
  it("M13a an alarm node with a fresh reading flows", () => {
    alarmedFreshNodeFlows();
  });
  it("M13b an alarm node with an old reading does not flow", () => {
    alarmedStaleNodeDoesNotFlow();
  });
  it("M13c live flows; stale, none and unassigned do not", () => {
    onlyFreshStatusesFlow();
  });
  it("M14 the accessible name lists every alarmed unit", () => {
    ariaLabelNamesEveryAlarmedUnit();
  });
});
