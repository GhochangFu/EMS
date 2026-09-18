// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  addingAMetricPatchesSourcesWithEmptyParams,
  hidesTheBlockForATypeThatBindsNoMetric,
  hidesTheMetricPickerAtTheCardinalityMax,
  hidesTheMetricPickerOnceARoleIsBound,
  hidesTheRolePickerOnceAMetricIsBound,
  listsEachSourceByItsCatalogLabelReadOnly,
  removingAMetricPatchesOnlySources,
  showsTheBlockForATable,
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
});
