import { afterEach, describe, it, vi } from "vitest";

import {
  appendChartWidgetAnswersTheParsedResponse,
  appendChartWidgetPostsToTheAppendRoute,
  appendChartWidgetRefusesAnAnswerWithoutTheStamp,
  appendChartWidgetSendsTheBody,
  appendTrendStripWidgetsAnswersTheParsedResponse,
  appendTrendStripWidgetsPostsToTheAppendRoute,
  appendTrendStripWidgetsRefusesTheChartAnswer,
  appendTrendStripWidgetsSendsTheBody,
  fetchDashboardsSendsAllThreeKeysInOrder,
  fetchDashboardsSendsAssetIdAlone,
  fetchDashboardsSendsLocationIdAlone,
  fetchDashboardsSendsOrganizationIdThenLocationId,
  fetchDashboardsSendsNoQueryWhenUnfiltered,
  fetchDashboardsSendsOrganizationIdThenAssetId,
  fetchDashboardsSendsSectionAlone,
} from "./dashboards.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6).
 * No `@vitest-environment` docblock: this file wants the project's `node`
 * default, not jsdom.
 */
describe("F3.31 dashboards web client — assetId reaches the wire", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends ?assetId= alone when only the asset is given", async () => {
    await fetchDashboardsSendsAssetIdAlone();
  });

  it("sends ?organizationId=&assetId= in that order when both are given", async () => {
    await fetchDashboardsSendsOrganizationIdThenAssetId();
  });

  it("sends no query string at all when unfiltered", async () => {
    await fetchDashboardsSendsNoQueryWhenUnfiltered();
  });

  it("sends ?section= alone when only the section is given (E4.2)", async () => {
    await fetchDashboardsSendsSectionAlone();
  });

  it("sends all three keys in the helper insertion order (E4.2)", async () => {
    await fetchDashboardsSendsAllThreeKeysInOrder();
  });

  it("sends ?locationId= alone when only the location is given (F3.72)", async () => {
    await fetchDashboardsSendsLocationIdAlone();
  });

  it("sends ?organizationId=&locationId= in that order when both are given (F3.72)", async () => {
    await fetchDashboardsSendsOrganizationIdThenLocationId();
  });
});

describe("F4.303 U15 appendChartWidget", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts to /dashboards/:id/widgets/append", async () => {
    await appendChartWidgetPostsToTheAppendRoute();
  });

  it("sends the body as given", async () => {
    await appendChartWidgetSendsTheBody();
  });

  it("answers the parsed widget and stamp", async () => {
    await appendChartWidgetAnswersTheParsedResponse();
  });

  it("refuses an answer the response schema does not admit", async () => {
    await appendChartWidgetRefusesAnAnswerWithoutTheStamp();
  });
});

describe("F4.306 U12 appendTrendStripWidgets", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts to /dashboards/:id/widgets/append", async () => {
    await appendTrendStripWidgetsPostsToTheAppendRoute();
  });

  it("sends the body as given", async () => {
    await appendTrendStripWidgetsSendsTheBody();
  });

  it("answers the parsed widgets and stamp", async () => {
    await appendTrendStripWidgetsAnswersTheParsedResponse();
  });

  it("refuses the chart arm's answer (widget, not widgets)", async () => {
    await appendTrendStripWidgetsRefusesTheChartAnswer();
  });
});
