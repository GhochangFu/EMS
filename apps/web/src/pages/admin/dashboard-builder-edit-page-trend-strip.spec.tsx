import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi, type Mock } from "vitest";

import type { DashboardDto, SiteTrendPointsDto, SiteTrendStripDto } from "@bms/shared";

import * as dashboardsApi from "../../api/dashboards";
import * as siteTrendPointsApi from "../../api/site-trend-points";
import * as trendStripApi from "../../api/trend-strip";
import { WIDGET_CATALOG } from "../../lib/widget-catalog";
import {
  DTO,
  GROUP,
  LOC_1,
  LOC_2,
  LOCATION,
  asUser,
  detailsWizard,
  openScopeStep,
  renderPage,
  stubLoads,
  submitWidgets,
  waitForPrefill,
  widgetsWizard,
} from "./dashboard-builder-edit-page.spec";

/**
 * `F4.306` PR 2 U13 (ADR 0108 Amendment 7 item 5; owner OQ5; plan D5) — the builder's "Trend strip
 * wizard" button. It shows on a location-scoped dashboard's Layout step only, and the wizard runs in
 * `draft` mode: Finish changes the canvas rows and makes no request; the widgets Save then sends the
 * selection in its PUT. A sibling of `dashboard-builder-edit-page.spec.tsx` (the §4.5 split) built on
 * its fixtures; `dashboard-builder-edit-page-trend-strip.test.tsx` is the Vitest entry point.
 *
 * `fetch` is a rejecting spy and {@link cleanupBuilderTrendStrip} fails the case if any read reached
 * it, so "no request until Save" is the spies below plus the raw network.
 */

const BUTTON = "Trend strip wizard";

const LISTS: SiteTrendPointsDto = {
  locationId: LOC_1,
  organizationId: DTO.organizationId,
  segments: [
    {
      domain: "seg_a",
      label: "Segment A",
      source: "organization",
      points: [1, 2, 3].map((n) => ({ code: `pt_${n}`, name: `Segment A point ${n}`, unit: null, active: true })),
      catalogDefaults: [],
      updatedAt: null,
      updatedBy: null,
    },
  ],
};

const STRIP: SiteTrendStripDto = {
  locationId: LOC_1,
  assetGroupId: null,
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

let fetchSpy: Mock = vi.fn();

type Spies = { put: Mock; append: Mock };

function openThePage(dto: DashboardDto = DTO, locations: readonly (typeof LOCATION)[] = [LOCATION]): Spies {
  fetchSpy = vi.fn(() => Promise.reject(new Error("builder trend strip spec: an unmocked read reached fetch")));
  vi.stubGlobal("fetch", fetchSpy);
  stubLoads({ dto, groups: [GROUP], locations });
  vi.spyOn(siteTrendPointsApi, "fetchSiteTrendPoints").mockResolvedValue(LISTS);
  vi.spyOn(trendStripApi, "fetchSiteTrendStrip").mockResolvedValue(STRIP);
  const put = vi.spyOn(dashboardsApi, "putDashboardWidgets").mockResolvedValue(dto) as unknown as Mock;
  const append = vi.spyOn(dashboardsApi, "appendTrendStripWidgets") as unknown as Mock;
  renderPage(asUser("admin"));
  return { put, append };
}

/** Restores the stubbed `fetch`, and fails the case if a read reached it. */
export function cleanupBuilderTrendStrip(): void {
  const calls = fetchSpy.mock.calls.length;
  vi.unstubAllGlobals();
  expect(calls, "an unmocked read reached fetch").toBe(0);
}

const dialog = (): HTMLElement => screen.getByRole("dialog", { name: "Trend strip setup" });

/** The wizard's Next — the page's own two wizards hold a Next of their own. */
async function next(): Promise<void> {
  await userEvent.click(within(dialog()).getByRole("button", { name: "Next" }));
}

/** Opens the wizard and walks it to Finish: the single canvas, Segment A, `series-2` on point 2. */
async function runTheWizard(): Promise<void> {
  await userEvent.click(within(widgetsWizard()).getByRole("button", { name: BUTTON }));
  await next();
  await userEvent.click(within(dialog()).getByRole("checkbox", { name: "Dashboard" }));
  await next();
  await userEvent.click(await screen.findByRole("checkbox", { name: "Segment A" }));
  await next();
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Colour of Segment A point 2" }), "series-2");
  await next();
  await next();
  await userEvent.click(within(dialog()).getByRole("button", { name: "Finish" }));
}

/** The button shows on a location-scoped dashboard's Layout step. */
export async function theButtonShowsOnALocationDashboard(): Promise<void> {
  openThePage();
  await waitForPrefill("Location");
  expect(within(widgetsWizard()).getByRole("button", { name: BUTTON })).toBeInTheDocument();
}

/** An organization-scoped dashboard has no site, so no button; the add buttons beside it still show. */
export async function theButtonIsAbsentOnAnOrganizationDashboard(): Promise<void> {
  openThePage({ ...DTO, locationId: null });
  await waitFor(() => expect(within(detailsWizard()).getByLabelText("Name")).not.toHaveValue(""));
  await openScopeStep();
  await screen.findByRole("radio", { name: "Organization-wide", checked: true });
  expect(within(widgetsWizard()).getByRole("button", { name: `+ ${WIDGET_CATALOG.value_tile.label}` })).toBeInTheDocument();
  expect(within(widgetsWizard()).queryByRole("button", { name: BUTTON })).toBeNull();
}

/** Plan D5 — a scope with unsaved changes disables the button, the widgets wizard's own rule. */
export async function theButtonIsDisabledWhileTheScopeIsUnsaved(): Promise<void> {
  const second = { ...LOCATION, id: LOC_2, code: "MUM", slug: "mumbai-works", name: "Mumbai Works" };
  openThePage(DTO, [LOCATION, second]);
  await waitForPrefill("Location");
  expect((within(widgetsWizard()).getByRole("button", { name: BUTTON }) as HTMLButtonElement).disabled).toBe(false);
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Location" }), LOC_2);
  const button = within(widgetsWizard()).getByRole("button", { name: BUTTON }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(button.title).toMatch(/^The scope has unsaved changes\./);
}

/** A click opens the wizard on its Site step. */
export async function clickingTheButtonOpensTheWizard(): Promise<void> {
  openThePage();
  await waitForPrefill("Location");
  expect(screen.queryByRole("dialog", { name: "Trend strip setup" })).toBeNull();
  await userEvent.click(within(widgetsWizard()).getByRole("button", { name: BUTTON }));
  expect(screen.getByRole("dialog", { name: "Trend strip setup" })).toBeInTheDocument();
}

/** Finish puts the strip on the canvas and closes the wizard. */
export async function finishPutsTheStripOnTheCanvas(): Promise<void> {
  openThePage();
  await waitForPrefill("Location");
  expect(within(widgetsWizard()).getByText("Add a widget to start composing this dashboard.")).toBeInTheDocument();
  await runTheWizard();
  expect(screen.queryByRole("dialog", { name: "Trend strip setup" })).toBeNull();
  expect(within(widgetsWizard()).getAllByText(WIDGET_CATALOG.trend_strip.label).length).toBeGreaterThan(0);
  expect(within(widgetsWizard()).queryByText("Add a widget to start composing this dashboard.")).toBeNull();
}

/** Finish in the builder makes no request: neither the trend arm nor the widgets PUT. */
export async function finishMakesNoRequest(): Promise<void> {
  const { put, append } = openThePage();
  await waitForPrefill("Location");
  await runTheWizard();
  await within(widgetsWizard()).findAllByText(WIDGET_CATALOG.trend_strip.label);
  expect(append).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
}

/** The widgets Save then sends the strip with its segments, points and colours in the PUT body. */
export async function saveSendsTheSelectionInThePut(): Promise<void> {
  const { put } = openThePage();
  await waitForPrefill("Location");
  await runTheWizard();
  await within(widgetsWizard()).findAllByText(WIDGET_CATALOG.trend_strip.label);
  await submitWidgets();
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  const body = put.mock.calls[0]?.[1] as { widgets: Array<{ widgetType: string; config: Record<string, unknown> }> };
  const strip = body.widgets.find((widget) => widget.widgetType === "trend_strip");
  expect(strip?.config).toMatchObject({
    segments: ["seg_a"],
    points: ["seg_a:pt_1", "seg_a:pt_2", "seg_a:pt_3"],
    colors: { "seg_a:pt_2": "series-2" },
  });
}
