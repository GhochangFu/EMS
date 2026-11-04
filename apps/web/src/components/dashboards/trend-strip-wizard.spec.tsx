import type { SiteTrendPointsDto, SiteTrendStripDto } from "@bms/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import { appendTrendStripWidgets } from "../../api/dashboards";
import { fetchSiteTrendPoints } from "../../api/site-trend-points";
import { fetchSiteTrendStrip } from "../../api/trend-strip";
import { ApiError } from "../../lib/api-error";
import { blankDashboardWidgetRow, type DashboardWidgetRow } from "../../lib/dashboard-builder-form";
import {
  TREND_STRIP_WIZARD_FULL_SENTENCE,
  TREND_STRIP_WIZARD_LISTS_CHANGED_SENTENCE,
  TrendStripWizard,
  type TrendStripWizardMode,
} from "./trend-strip-wizard";

/**
 * `F4.306` PR 2 U12 (ADR 0108 Amendment 7 items 5–7) — the trend strip setup dialog. One claim per
 * exported case. Every api module the dialog (and the Preview's `TrendStripBody`) imports is
 * mocked; `fetch` is a rejecting spy, and {@link cleanupTrendStripWizard} fails the case if any
 * read reached it — so the builder's draft run is proved to make no request.
 *
 * Assertions live here; `trend-strip-wizard.test.tsx` is the Vitest entry point and carries the
 * jsdom docblock (ADR 0014, ADR 0042 decision 2).
 */

vi.mock("../../api/site-trend-points", () => ({ fetchSiteTrendPoints: vi.fn() }));
vi.mock("../../api/dashboards", () => ({ appendTrendStripWidgets: vi.fn() }));
vi.mock("../../api/trend-strip", () => ({ fetchSiteTrendStrip: vi.fn() }));
vi.mock("../../api/view-exports", () => ({ downloadTrendStripExport: vi.fn() }));

const fetchLists = vi.mocked(fetchSiteTrendPoints);
const appendStrips = vi.mocked(appendTrendStripWidgets);
const fetchStrip = vi.mocked(fetchSiteTrendStrip);
let fetchSpy: ReturnType<typeof vi.fn> = vi.fn();

const DASHBOARD_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "22222222-2222-4222-8222-222222222222";
const GROUP_ID = "33333333-3333-4333-8333-333333333333";

const TABS = [
  { id: "aaaaaaaa-0000-4000-8000-000000000001", key: "overview", label: "Overview", sortOrder: 0, assetGroupId: null },
  { id: "aaaaaaaa-0000-4000-8000-000000000002", key: "tab_b", label: "Tab B", sortOrder: 1, assetGroupId: GROUP_ID },
  { id: "aaaaaaaa-0000-4000-8000-000000000003", key: "tab_full", label: "Tab Full", sortOrder: 2, assetGroupId: null },
];

function row(widgetType: "trend_strip" | "value_tile", tabKey: string, gridY: number): DashboardWidgetRow {
  return { ...blankDashboardWidgetRow(widgetType), id: `${tabKey}-${gridY}`, title: `${widgetType} ${gridY}`, tabKey, gridY };
}

/** Overview holds a strip; Tab B is empty; Tab Full holds the cap and no strip. */
const ROWS: DashboardWidgetRow[] = [
  row("trend_strip", "overview", 0),
  row("value_tile", "overview", 4),
  ...Array.from({ length: 40 }, (_, index) => row("value_tile", "tab_full", index * 2)),
];

function segment(domain: string, label: string, count: number): SiteTrendPointsDto["segments"][number] {
  return {
    domain,
    label,
    source: "organization",
    points: Array.from({ length: count }, (_, index) => ({
      code: `pt_${index + 1}`,
      name: `${label} point ${index + 1}`,
      unit: null,
      active: true,
    })),
    catalogDefaults: [],
    updatedAt: null,
    updatedBy: null,
  };
}

/** Eleven segments of four points: the default (3 each, cut at 30) fills the cap. */
const SEGMENT_NUMBERS = Array.from({ length: 11 }, (_, index) => String(index + 1).padStart(2, "0"));
const LISTS: SiteTrendPointsDto = {
  locationId: LOCATION_ID,
  organizationId: "44444444-4444-4444-8444-444444444444",
  segments: SEGMENT_NUMBERS.map((n) => segment(`seg_${n}`, `Segment ${n}`, 4)),
};

const STRIP: SiteTrendStripDto = {
  locationId: LOCATION_ID,
  assetGroupId: GROUP_ID,
  range: "24h",
  from: "2026-11-03T10:00:00.000Z",
  to: "2026-11-04T10:00:00.000Z",
  level: "1h",
  bucketSeconds: 3600,
  timeZone: "UTC",
  assetsPerPoint: 6,
  pointsPerSegment: 3,
  trimmed: false,
  segments: [],
};

type Rendered = { onApply: ReturnType<typeof vi.fn>; onDone: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> };

function renderWizard(kind: "draft" | "append"): Rendered {
  fetchSpy = vi.fn(() => Promise.reject(new Error("trend strip wizard spec: an unmocked read reached fetch")));
  vi.stubGlobal("fetch", fetchSpy);
  fetchLists.mockResolvedValue(LISTS);
  fetchStrip.mockResolvedValue(STRIP);
  const onApply = vi.fn();
  const onDone = vi.fn();
  const onClose = vi.fn();
  const mode: TrendStripWizardMode = kind === "draft" ? { kind, rows: ROWS, onApply } : { kind, onDone };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TrendStripWizard
          dashboard={{ id: DASHBOARD_ID, locationId: LOCATION_ID, tabs: TABS, widgets: ROWS }}
          mode={mode}
          onClose={onClose}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onApply, onDone, onClose };
}

/** Unmounts, restores the stubbed `fetch`, resets the mocks, and fails the case on a raw read. */
export function cleanupTrendStripWizard(): void {
  cleanup();
  const calls = fetchSpy.mock.calls.length;
  vi.unstubAllGlobals();
  fetchLists.mockReset();
  appendStrips.mockReset();
  fetchStrip.mockReset();
  expect(calls, "an unmocked read reached fetch").toBe(0);
}

const user = () => userEvent.setup();

async function next(): Promise<void> {
  await user().click(screen.getByRole("button", { name: "Next" }));
}

/** From the Site step: choose `tabs`, then `segments`, and stop on the Points step. */
async function toPoints(tabs: readonly string[], segments: readonly string[]): Promise<void> {
  await next();
  for (const label of tabs) await user().click(screen.getByRole("checkbox", { name: label }));
  await next();
  for (const label of segments) await user().click(await screen.findByRole("checkbox", { name: label }));
  await next();
}

/** From the Points step: through Range to Preview. */
async function toPreview(): Promise<void> {
  await next();
  await next();
}

/** The Tabs step marks the tab that holds a strip: it will be replaced. */
export async function theTabsStepMarksTheTabWithAStrip(): Promise<void> {
  renderWizard("append");
  await next();
  const item = screen.getByRole("checkbox", { name: "Overview" }).closest("li");
  expect(item).not.toBeNull();
  expect(within(item as HTMLElement).getByText("Replaces this tab's strip")).toBeTruthy();
  const empty = screen.getByRole("checkbox", { name: "Tab B" }).closest("li");
  expect(within(empty as HTMLElement).queryByText("Replaces this tab's strip")).toBeNull();
}

/** The Tabs step disables a tab at the widget cap with no strip to replace, and not the others. */
export async function theTabsStepDisablesTheFullTab(): Promise<void> {
  renderWizard("append");
  await next();
  expect((screen.getByRole("checkbox", { name: "Tab Full" }) as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText("Full (40 widgets)")).toBeTruthy();
  expect((screen.getByRole("checkbox", { name: "Tab B" }) as HTMLInputElement).disabled).toBe(false);
}

/** The Segments step lists the site's segments by the DTO's labels, read for the dashboard's site. */
export async function theSegmentsStepListsTheDtoLabels(): Promise<void> {
  renderWizard("append");
  await next();
  await user().click(screen.getByRole("checkbox", { name: "Tab B" }));
  await next();
  expect(await screen.findByRole("checkbox", { name: "Segment 01" })).toBeTruthy();
  expect(screen.getAllByRole("checkbox")).toHaveLength(11);
  expect(fetchLists).toHaveBeenCalledWith(LOCATION_ID);
}

/** The Points step opens on the first 3 points of each chosen segment; the 4th is open to check. */
export async function thePointsStepPreselectsThreePerSegment(): Promise<void> {
  renderWizard("append");
  await toPoints(["Tab B"], ["Segment 01", "Segment 02"]);
  for (const n of [1, 2, 3]) {
    expect((screen.getByRole("checkbox", { name: `Segment 01 point ${n}` }) as HTMLInputElement).checked).toBe(true);
  }
  const fourth = screen.getByRole("checkbox", { name: "Segment 01 point 4" }) as HTMLInputElement;
  expect(fourth.checked).toBe(false);
  expect(fourth.disabled).toBe(false);
  expect(screen.getByText("6 of 30")).toBeTruthy();
}

/** At 30 chosen points an unchecked box is disabled, and a checked one is not. */
export async function theThirtyFirstBoxIsDisabled(): Promise<void> {
  renderWizard("append");
  await toPoints(["Tab B"], SEGMENT_NUMBERS.map((n) => `Segment ${n}`));
  expect(screen.getByText("30 of 30")).toBeTruthy();
  expect((screen.getByRole("checkbox", { name: "Segment 01 point 4" }) as HTMLInputElement).disabled).toBe(true);
  const checked = screen.getByRole("checkbox", { name: "Segment 01 point 1" }) as HTMLInputElement;
  expect(checked.checked).toBe(true);
  expect(checked.disabled).toBe(false);
}

async function finish(): Promise<void> {
  await user().click(screen.getByRole("button", { name: "Finish" }));
}

/** The colour select writes `colors[key]` with the chosen role. */
export async function theColourSelectWritesTheRole(): Promise<void> {
  renderWizard("append");
  appendStrips.mockResolvedValue({ widgets: [], updatedAt: "2026-11-04T10:00:00.000+00:00" } as never);
  await toPoints(["Tab B"], ["Segment 01"]);
  await user().selectOptions(screen.getByRole("combobox", { name: "Colour of Segment 01 point 2" }), "series-2");
  await toPreview();
  await finish();
  await waitFor(() => expect(appendStrips).toHaveBeenCalledTimes(1));
  expect(appendStrips.mock.calls[0]?.[1].strips[0]?.config.colors).toEqual({ "seg_01:pt_2": "series-2" });
}

/** "Default" deletes the key: no `colors` is stored when no point keeps a role. */
export async function theDefaultOptionDeletesTheKey(): Promise<void> {
  renderWizard("append");
  appendStrips.mockResolvedValue({ widgets: [], updatedAt: "2026-11-04T10:00:00.000+00:00" } as never);
  await toPoints(["Tab B"], ["Segment 01"]);
  const select = screen.getByRole("combobox", { name: "Colour of Segment 01 point 2" });
  await user().selectOptions(select, "series-2");
  await user().selectOptions(select, "");
  await toPreview();
  await finish();
  await waitFor(() => expect(appendStrips).toHaveBeenCalledTimes(1));
  expect(appendStrips.mock.calls[0]?.[1].strips[0]?.config).not.toHaveProperty("colors");
}

/** The Preview draws the strip body over the chosen tab's group with the selection. */
export async function thePreviewReadsTheStripWithTheSelection(): Promise<void> {
  renderWizard("append");
  await toPoints(["Tab B"], ["Segment 01"]);
  await toPreview();
  await waitFor(() => expect(fetchStrip).toHaveBeenCalled());
  expect(fetchStrip).toHaveBeenCalledWith(LOCATION_ID, {
    range: "24h",
    assetGroupId: GROUP_ID,
    segments: ["seg_01"],
    points: ["seg_01:pt_1", "seg_01:pt_2", "seg_01:pt_3"],
  });
}

/** Draft Finish hands the builder rows with the chosen tab's strip replaced, then closes; no request. */
export async function draftFinishAppliesRowsAndRequestsNothing(): Promise<void> {
  const { onApply, onClose } = renderWizard("draft");
  await toPoints(["Overview"], ["Segment 01"]);
  await toPreview();
  await finish();
  expect(onApply).toHaveBeenCalledTimes(1);
  const rows = onApply.mock.calls[0]?.[0] as DashboardWidgetRow[];
  expect(rows).toHaveLength(ROWS.length);
  expect(rows[0]?.id).toBe(ROWS[0]?.id);
  expect(rows[0]?.config.stripPoints).toEqual(["seg_01:pt_1", "seg_01:pt_2", "seg_01:pt_3"]);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(appendStrips).not.toHaveBeenCalled();
}

/** Append Finish posts one body, one strip per chosen tab in tab order, then calls `onDone`. */
export async function appendFinishPostsOneBodyInTabOrder(): Promise<void> {
  const { onDone, onApply } = renderWizard("append");
  appendStrips.mockResolvedValue({ widgets: [], updatedAt: "2026-11-04T10:00:00.000+00:00" } as never);
  await toPoints(["Tab B", "Overview"], ["Segment 01"]);
  await toPreview();
  await finish();
  await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  expect(appendStrips).toHaveBeenCalledTimes(1);
  const [id, body] = appendStrips.mock.calls[0] ?? [];
  expect(id).toBe(DASHBOARD_ID);
  expect(body?.strips.map((strip) => strip.tabKey)).toEqual(["overview", "tab_b"]);
  expect(body?.strips[1]?.config.tabKey).toBe("tab_b");
  expect(body?.strips[0]?.config).not.toHaveProperty("tabKey");
  expect(onApply).not.toHaveBeenCalled();
}

async function failWith(status: number): Promise<void> {
  renderWizard("append");
  appendStrips.mockRejectedValue(new ApiError("server text that must not show", status));
  await toPoints(["Tab B"], ["Segment 01"]);
  await toPreview();
  await finish();
}

/** A 409 shows the full-tab sentence, never the server's text. */
export async function aConflictShowsTheFullSentence(): Promise<void> {
  await failWith(409);
  expect((await screen.findByRole("alert")).textContent).toBe(TREND_STRIP_WIZARD_FULL_SENTENCE);
}

/** A 400 shows the lists-changed sentence (the adjacent status to the 409). */
export async function aBadRequestShowsTheListsSentence(): Promise<void> {
  await failWith(400);
  expect((await screen.findByRole("alert")).textContent).toBe(TREND_STRIP_WIZARD_LISTS_CHANGED_SENTENCE);
}

/** While the append is pending the Finish button is `aria-busy` and disabled, labelled `Saving…`. */
export async function theFinishButtonIsBusyWhilePending(): Promise<void> {
  renderWizard("append");
  appendStrips.mockReturnValue(new Promise(() => undefined));
  await toPoints(["Tab B"], ["Segment 01"]);
  await toPreview();
  await finish();
  const busy = await screen.findByRole("button", { name: "Saving…" });
  expect(busy.getAttribute("aria-busy")).toBe("true");
  expect((busy as HTMLButtonElement).disabled).toBe(true);
}
