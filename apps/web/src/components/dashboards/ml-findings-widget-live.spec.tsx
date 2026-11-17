import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi, type MockInstance } from "vitest";

import type { DashboardWidgetDto } from "@bms/shared";
import type { MlFindingsCard as MlFindingsCardData, MlFindingsSummaryResponse } from "@bms/shared/contracts";

import * as mlApi from "../../api/ml";
import { MlFindingsWidgetLive, type MlFindingsWidgetScope } from "./ml-findings-widget-live";

/**
 * `E1.9f` (ADR 0135 Amendment 8 decision 13; plan T6.6) — the live `ml_findings` widget: the shared
 * `MlFindingsCard` inside the widget frame, on its dashboard's own scope. The reads are stubbed at
 * `fetchMlFindingsSummary` and `fetchMlFindingsParagraph`; every name is made up.
 * `ml-findings-widget-live.test.tsx` is the Vitest entry point.
 */

const ORG = "aaaaaaaa-3333-4333-8333-000000000001";
const LOCATION = "bbbbbbbb-3333-4333-8333-000000000001";
const GROUP = "cccccccc-3333-4333-8333-000000000001";
const ASSET = "dddddddd-3333-4333-8333-000000000001";

/** A card with a finding, so a paragraph would be asked for if the widget allowed one. */
const CARD: MlFindingsCardData = {
  organizationId: ORG,
  organizationCode: "ORGM",
  organizationName: "Maple Ridge Works",
  facts: [{ id: "F1", segments: [{ text: "2 forecast points, issued at 16 Nov 14:05; 0 stale." }] }],
  assets: [],
};

const SUMMARY: MlFindingsSummaryResponse = { asOf: "2026-11-16T09:00:00.000Z", cards: [CARD] };

function widget(config: Record<string, unknown>, title: string | null = "Plant findings"): Extract<
  DashboardWidgetDto,
  { widgetType: "ml_findings" }
> {
  return {
    id: "widget-mf",
    dashboardId: "dash-mf",
    organizationId: ORG,
    title,
    gridX: 0,
    gridY: 0,
    gridW: 6,
    gridH: 4,
    points: [],
    sources: [],
    tabId: null,
    widgetType: "ml_findings",
    config,
  } as Extract<DashboardWidgetDto, { widgetType: "ml_findings" }>;
}

const LOCATION_SCOPE: MlFindingsWidgetScope = {
  organizationId: ORG,
  locationId: LOCATION,
  assetGroupId: null,
  assetId: null,
};

function renderWidget(config: Record<string, unknown>, scope: MlFindingsWidgetScope = LOCATION_SCOPE): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MlFindingsWidgetLive widget={widget(config)} scope={scope} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Lets every settled promise and React update land. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

let summarySpy: MockInstance<typeof mlApi.fetchMlFindingsSummary> | null = null;
let paragraphSpy: MockInstance<typeof mlApi.fetchMlFindingsParagraph> | null = null;

/** Both reads stubbed; the paragraph answers no cards. */
export function stubMlReads(): void {
  summarySpy = vi.spyOn(mlApi, "fetchMlFindingsSummary").mockResolvedValue(SUMMARY);
  paragraphSpy = vi.spyOn(mlApi, "fetchMlFindingsParagraph").mockResolvedValue({ cards: [] });
}

export function restoreMlReads(): void {
  vi.restoreAllMocks();
  summarySpy = null;
  paragraphSpy = null;
}

const kindsAsked = (): unknown[] => (summarySpy?.mock.calls ?? []).map((call) => call[0]);

/** The title is drawn in the frame, and the card's facts beneath it. */
export async function theFrameDrawsTheTitleAndTheFacts(): Promise<void> {
  renderWidget({ show: "both", paragraph: true });
  expect(await screen.findByText("Plant findings")).toBeInTheDocument();
  expect(await screen.findAllByText("ORGM · Maple Ridge Works")).not.toHaveLength(0);
}

/** `show: "forecasts"` asks for the forecast summary only; `"both"` (and `{}`) for both kinds, in order. */
export async function showPicksTheKinds(): Promise<void> {
  renderWidget({ show: "forecasts", paragraph: true });
  await screen.findByText("ORGM · Maple Ridge Works");
  await settle();
  expect(kindsAsked()).toEqual(["forecasts"]);
}

export async function showAnomaliesAsksForAnomaliesOnly(): Promise<void> {
  renderWidget({ show: "anomalies", paragraph: true });
  await screen.findByText("ORGM · Maple Ridge Works");
  await settle();
  expect(kindsAsked()).toEqual(["anomalies"]);
}

export async function anEmptyConfigAsksForBothKinds(): Promise<void> {
  renderWidget({});
  await screen.findAllByText("ORGM · Maple Ridge Works");
  await settle();
  expect(kindsAsked()).toEqual(["forecasts", "anomalies"]);
  // R-u: an absent `paragraph` reads as `true`, so the paragraph is asked for each kind.
  expect((paragraphSpy?.mock.calls ?? []).map((call) => call[0])).toEqual(["forecasts", "anomalies"]);
}

/** `paragraph: false` makes no paragraph request; `paragraph: true` (the control) makes one per kind. */
export async function paragraphOffMakesNoParagraphRequest(): Promise<void> {
  renderWidget({ show: "forecasts", paragraph: false });
  await screen.findByText("ORGM · Maple Ridge Works");
  await settle();
  expect(paragraphSpy).not.toHaveBeenCalled();
}

export async function paragraphOnAsksForTheParagraph(): Promise<void> {
  renderWidget({ show: "forecasts", paragraph: true });
  await screen.findByText("ORGM · Maple Ridge Works");
  await settle();
  expect(paragraphSpy).toHaveBeenCalledWith("forecasts", { organizationId: ORG, locationId: LOCATION });
}

/** The read's scope is the dashboard's organization plus its one set id: location, group or asset. */
export async function theScopeIsTheDashboardsOwn(): Promise<void> {
  const cases: { scope: MlFindingsWidgetScope; sent: Record<string, string> }[] = [
    {
      scope: { organizationId: ORG, locationId: null, assetGroupId: null, assetId: null },
      sent: { organizationId: ORG },
    },
    { scope: LOCATION_SCOPE, sent: { organizationId: ORG, locationId: LOCATION } },
    {
      scope: { organizationId: ORG, locationId: null, assetGroupId: GROUP, assetId: null },
      sent: { organizationId: ORG, assetGroupId: GROUP },
    },
    {
      scope: { organizationId: ORG, locationId: null, assetGroupId: null, assetId: ASSET },
      sent: { organizationId: ORG, assetId: ASSET },
    },
  ];
  for (const { scope, sent } of cases) {
    summarySpy?.mockClear();
    renderWidget({ show: "anomalies", paragraph: false }, scope);
    await screen.findByText("ORGM · Maple Ridge Works");
    expect(summarySpy?.mock.calls.map((call) => call[1])).toEqual([sent]);
    // One widget at a time: the next case renders its own.
    cleanup();
  }
}
