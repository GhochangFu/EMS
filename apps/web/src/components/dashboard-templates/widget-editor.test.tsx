// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  addingAMetricPatchesSourcesWithEmptyParams,
  choosingADepthPatchesOnlyThatSource,
  eachSiteRemovesTheKey,
  readOnlyShowsTheDepthAsText,
  theGroupBySelectRendersOnlyForByLocation,
  theOptionsRunToTheMaxDepth,
  hidesTheBlockForATypeThatBindsNoMetric,
  hidesTheMetricPickerAtTheCardinalityMax,
  hidesTheMetricPickerOnceARoleIsBound,
  hidesTheRolePickerOnceAMetricIsBound,
  hidesTheWaterBalanceNoteForANonWaterSource,
  hidesTheWaterBalanceNoteForAnOutletVolumeSource,
  hidesTheWaterBalanceNoteForARoledWaterVolumeSource,
  listsEachSourceByItsCatalogLabelReadOnly,
  removingAMetricPatchesOnlySources,
  showsTheBlockForATable,
  showsTheWaterBalanceNoteForAnUnroledWaterVolumeSource,
  showsTheWaterBalanceNoteReadOnlyToo,
} from "./widget-editor.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom
 * docblock is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F3.61 — the template WidgetEditor's Named metric block", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("lists each source by its catalog label, read-only, with no writable control", () => {
    listsEachSourceByItsCatalogLabelReadOnly();
  });

  it("hides the block for a type that binds no metric", () => {
    hidesTheBlockForATypeThatBindsNoMetric();
  });

  it("shows the block for a table — the gate reads the catalog", () => {
    showsTheBlockForATable();
  });

  it("adding a metric patches sources with empty params and a sortOrder, nothing else", async () => {
    await addingAMetricPatchesSourcesWithEmptyParams();
  });

  it("removing a metric patches sources only, never config", async () => {
    await removingAMetricPatchesOnlySources();
  });

  it("hides the role picker once a metric is bound", () => {
    hidesTheRolePickerOnceAMetricIsBound();
  });

  it("hides the metric picker once a role is bound", () => {
    hidesTheMetricPickerOnceARoleIsBound();
  });

  it("hides the metric picker at the cardinality maximum", () => {
    hidesTheMetricPickerAtTheCardinalityMax();
  });

  it("shows the water-balance note for an unroled kl_* source", () => {
    showsTheWaterBalanceNoteForAnUnroledWaterVolumeSource();
  });

  it("hides the water-balance note once balanceRole is set", () => {
    hidesTheWaterBalanceNoteForARoledWaterVolumeSource();
  });

  it("hides the water-balance note for a non-water pointKey", () => {
    hidesTheWaterBalanceNoteForANonWaterSource();
  });

  it("hides the water-balance note for an outlet-volume pointKey", () => {
    hidesTheWaterBalanceNoteForAnOutletVolumeSource();
  });

  it("shows the water-balance note read-only too (the stock viewer)", () => {
    showsTheWaterBalanceNoteReadOnlyToo();
  });
});

describe("F2.10 WidgetEditor — groupDepth for sustainability.by_location", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("G1 renders Group by for the by_location source, not for the total beside it", () => {
    theGroupBySelectRendersOnlyForByLocation();
  });

  it("G2 choosing depth 2 patches only sources, with groupDepth a number", async () => {
    await choosingADepthPatchesOnlyThatSource();
  });

  it("G3 Each site removes groupDepth", async () => {
    await eachSiteRemovesTheKey();
  });

  it("G4 read-only shows the depth as text and no select", () => {
    readOnlyShowsTheDepthAsText();
  });

  it("G5 the options run from 1 to LOCATION_TREE_MAX_DEPTH", () => {
    theOptionsRunToTheMaxDepth();
  });
});
