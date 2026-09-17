// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  adminSeesBothAssetsLinks,
  clickingARowOpensThePanelForThatRow,
  anEmptyFilterResultSaysSo,
  columnsMapToTheRow,
  emptyDashboardsSentenceDependsOnTemplateId,
  filtersNarrowTheTable,
  panelCarriesNoWriteAffordance,
  panelListsDashboardsWithSlugLinks,
  panelShowsTheHealthCard,
  viewerSeesAssetsUnderOperations,
} from "./assets-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.31 assets browser page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("P1 — shows a viewer the Assets link under Operations", async () => {
    await viewerSeesAssetsUnderOperations();
  });

  it("P1 — shows an admin both Assets links", async () => {
    await adminSeesBothAssetsLinks();
  });

  it("P2 — a row click opens the panel for that row", async () => {
    await clickingARowOpensThePanelForThatRow();
  });

  it("P3 — the panel lists the asset's dashboards as slug links, read by assetId", async () => {
    await panelListsDashboardsWithSlugLinks();
  });

  it("P4 — the empty-dashboards sentence depends on templateId", async () => {
    await emptyDashboardsSentenceDependsOnTemplateId();
  });

  it("P5 — the panel shows the health card", async () => {
    await panelShowsTheHealthCard();
  });

  it("P6 — the domain select and the text filter narrow the table", async () => {
    await filtersNarrowTheTable();
  });

  it("P7 — the panel carries no write affordance", async () => {
    await panelCarriesNoWriteAffordance();
  });

  it("P8 — the columns map to the row", async () => {
    await columnsMapToTheRow();
  });

  it("P9 — an empty filter result says so in the table", async () => {
    await anEmptyFilterResultSaysSo();
  });
});
