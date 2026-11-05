// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { resetWizardStore } from "../../stores/wizard-store";
import {
  theAddWizardNamesTheRoutedAssetByItsLabel,
  theAssetCellNamesTheLocationWithoutAnRtu,
  theAssetCellNamesTheRtu,
  theEditWizardNamesTheAssetByItsLabel,
  theStatusWizardNamesTheAssetByItsLabel,
  theWherePartWrapsAndIsNeverTruncated,
} from "./asset-points-page.asset-label.spec";

/** A wizard walk under jsdom takes seconds. */
const SLOW = 20_000;

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.316 PR 5 — the asset-points page names the asset by its label (ADR 0111)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetWizardStore();
  });

  it("names an asset on an RTU <code> · <RTU> in the Asset cell", () => theAssetCellNamesTheRtu(), SLOW);
  it("names an RTU-less asset <code> · <location> in the Asset cell", () => theAssetCellNamesTheLocationWithoutAnRtu(), SLOW);
  it("wraps the where part and never truncates it", () => theWherePartWrapsAndIsNeverTruncated(), SLOW);
  it("names the edited asset by its label on the Edit wizard", () => theEditWizardNamesTheAssetByItsLabel(), SLOW);
  it("names the routed asset by its label on the Add wizard", () => theAddWizardNamesTheRoutedAssetByItsLabel(), SLOW);
  it("names the asset by its label in the Deactivate wizard's title", () => theStatusWizardNamesTheAssetByItsLabel(), SLOW);
});
