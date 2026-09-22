// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  anAssetGroupRowIsLabelledAssetGroupNotOrganizationWide,
  anAssetScopedRowIsLabelledAssetWithItsCode,
  anAssetScopedRowWithNoCodeStillReadsAsset,
  anAuthoringRoleSeesTheManageLink,
  assetGroupAdminSeesTheManageLink,
  rendersEveryRowTheApiReturns,
  viewerRoleSeesNoAuthoringAffordance,
  anEmptyUnfilteredListKeepsItsOriginalWording,
  anOperatorSeesTheHintWithoutTheLink,
  theEmptySustainabilitySectionShowsTheImportHint,
  theSectionQueryReachesTheApi,
  theSubtitleNamesTheSection,
} from "./dashboards-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.1d dashboards page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows a viewer no authoring affordance", async () => {
    await viewerRoleSeesNoAuthoringAffordance();
  });

  it("shows an authoring role the Manage dashboards link", async () => {
    await anAuthoringRoleSeesTheManageLink();
  });

  it("renders every row the API returns, without re-deriving visibility", async () => {
    await rendersEveryRowTheApiReturns();
  });

  it("shows an asset_group_admin the Manage dashboards link", async () => {
    await assetGroupAdminSeesTheManageLink();
  });

  it("labels an asset-group row 'Asset group', not 'Organization-wide'", async () => {
    await anAssetGroupRowIsLabelledAssetGroupNotOrganizationWide();
  });

  it("labels an asset-scoped row 'Asset · <code>', not 'Organization-wide'", async () => {
    await anAssetScopedRowIsLabelledAssetWithItsCode();
  });

  it("labels an asset-scoped row with no code 'Asset'", async () => {
    await anAssetScopedRowWithNoCodeStillReadsAsset();
  });
});

describe("E4.2 — the dashboards list filtered by section", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("passes the section from the URL to the API", async () => {
    await theSectionQueryReachesTheApi();
  });

  it("shows the import hint with a link for a master-data admin", async () => {
    await theEmptySustainabilitySectionShowsTheImportHint();
  });

  it("keeps the original empty wording when no section is set", async () => {
    await anEmptyUnfilteredListKeepsItsOriginalWording();
  });

  it("shows an operator the hint without the link", async () => {
    await anOperatorSeesTheHintWithoutTheLink();
  });

  it("names the section in the subtitle", async () => {
    await theSubtitleNamesTheSection();
  });
});
