// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  cleanupView,
  linkOpensTheViewer,
  noEditLink,
  pendingReadRendersNoCanvas,
  pendingReadSaysLoading,
  readCarriesTheSiteOrganization,
  rejectedReadRendersNoCanvas,
  rejectedReadShowsTheApiMessage,
  resolvedReadRendersTheCanvas,
  titleIsTheDashboardName,
  tryAgainInvalidatesTheResolveRead,
  tryAgainRereadsTheDashboard,
} from "./site-dashboard-view.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.69 SiteDashboardView", () => {
  afterEach(() => {
    cleanupView();
  });

  it("S1 reads the dashboard by slug and the site's organization id", async () => {
    await readCarriesTheSiteOrganization();
  });

  it("S2 titles the section with the dashboard's name", async () => {
    await titleIsTheDashboardName();
  });

  it("S3 links Open in Dashboards to the viewer with the organization id", async () => {
    await linkOpensTheViewer();
  });

  it("S4a says loading while the read is pending", async () => {
    await pendingReadSaysLoading();
  });

  it("S4b renders no canvas while the read is pending", async () => {
    await pendingReadRendersNoCanvas();
  });

  it("S5 hands the resolved DTO to the live canvas", async () => {
    await resolvedReadRendersTheCanvas();
  });

  it("S6a shows the API's message in an alert on a rejected read", async () => {
    await rejectedReadShowsTheApiMessage();
  });

  it("S6b renders no canvas on a rejected read", async () => {
    await rejectedReadRendersNoCanvas();
  });

  it("S7a re-reads the dashboard on Try again and renders the answer", async () => {
    await tryAgainRereadsTheDashboard();
  });

  it("S7b invalidates the site page's resolve read on Try again", async () => {
    await tryAgainInvalidatesTheResolveRead();
  });

  it("S8 shows no Edit dashboard link", async () => {
    await noEditLink();
  });
});
