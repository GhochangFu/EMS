import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { EnergyReportPreview, ReportFileDto } from "@bms/shared";

import * as locationsApi from "../api/admin/locations";
import * as organizationsApi from "../api/admin/organizations";
import * as notificationsApi from "../api/notifications";
import * as reportsApi from "../api/reports";
import { ApiError } from "../lib/api-error";
import type { AuthUser } from "../stores/auth-store";
import { ReportsPanel } from "./reports-panel";

/**
 * `F2.8` — the Reports panel PUE tile, on a measured ratio and on a null.
 * `F3.5a` Unit 11 — the PDF button, the Save-to-history block and the role
 * gate on it (ADR 0071 decision 12; R-13).
 *
 * Assertions live here; `reports-panel.test.tsx` is the Vitest entry point and
 * carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042
 * decision 2).
 *
 * This tile is the screen beside the export, so it and `reports.serialise.ts`
 * have to agree on what "nothing configured" looks like: the panel renders the
 * `—` `KpiTile` draws for an empty tile and the CSV writes the same U+2014 in
 * the `PUE estimate` cell. Its old hint said "Prototype estimate", which is what
 * ruling 4 stops being true.
 */

const NOT_CONFIGURED = "Not configured — no incomer in scope computes site_kw and it_kw";
const MEASURED_HINT = "Σ site kW ÷ Σ IT kW, from the incomers' site_kw / it_kw";
const ORGANIZATION_SENTENCE = "Choose an organization to file the report under.";

const VIEWER: AuthUser = {
  id: "9b1d2c3e-0000-4a5b-8c4d-000000000001",
  email: "viewer@bms.local",
  displayName: "Viewer",
  role: "viewer",
};

function userWithRole(role: AuthUser["role"]): AuthUser {
  return { ...VIEWER, role };
}

const ESKOM = {
  id: "5c2c1b0e-2222-4a5b-8c4d-000000000010",
  code: "ESKOM",
  name: "Eskom SMOC",
  active: true,
  currency: "ZAR",
  meta: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const SAVED: ReportFileDto = {
  id: "0f0a4a1e-1111-4a5b-8c4d-000000000001",
  organizationId: ESKOM.id,
  templateId: "energy_consumption",
  format: "pdf",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-05",
  locationIds: [],
  contentType: "application/pdf",
  byteSize: 12_345,
  sha256: "a".repeat(64),
  filename: "energy-consumption-2026-09-01-to-2026-09-05.pdf",
  deliveryStatus: "none",
  deliveryError: null,
  scheduleId: null,
  createdBy: null,
  createdAt: "2026-09-05T12:00:00.000Z",
};

function preview(
  pueEstimate: number | null,
  cost: Partial<EnergyReportPreview["summary"]> = {},
): EnergyReportPreview {
  return {
    template: {
      id: "energy_consumption",
      title: "Energy Consumption",
      description: "Multi-site kWh, demand, PUE, cost, source mix, and top loads.",
      formats: ["CSV"],
      active: true,
    },
    range: { startDate: "2026-09-01", endDate: "2026-09-05", durationHours: 96 },
    generatedAt: "2026-09-05T12:00:00.000Z",
    summary: {
      window: "custom",
      totalKwh: 2345.17,
      peakKw: 414.66,
      pueEstimate,
      // `E4.1c` — nullable, currency-neutral; `ZAR` is the fixture's organization.
      indicativeCost: 5042.12,
      tariffPerKwh: 2.15,
      currency: "ZAR",
      asOf: "2026-09-05T12:00:00.000Z",
      ...cost,
    },
    sourceTotals: { gridKwh: 2130.37, solarKwh: 126.04, dgKwh: 88.76 },
    topConsumers: [],
    notes: [],
  };
}

function renderPanel(
  pueEstimate: number | null,
  cost: Partial<EnergyReportPreview["summary"]> = {},
  user: AuthUser = VIEWER,
): void {
  vi.spyOn(reportsApi, "fetchEnergyReportPreview").mockResolvedValue(preview(pueEstimate, cost));
  // The History list and the organization select fetch on mount for the
  // admin roles; stubbed so no row here depends on the network.
  vi.spyOn(reportsApi, "fetchReportFiles").mockResolvedValue([]);
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({ items: [ESKOM] });
  // `F3.5b` — the Schedules section reads three more lists at mount.
  vi.spyOn(reportsApi, "fetchReportSchedules").mockResolvedValue([]);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: [] });
  vi.spyOn(notificationsApi, "fetchNotificationChannels").mockResolvedValue({ items: [] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ReportsPanel user={user} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * The preview has resolved when its range line renders — the Save button and
 * the export buttons exist before the data, so waiting on them resolves at
 * once and the click lands on a disabled control.
 */
async function previewResolved(): Promise<void> {
  await screen.findByText(/2026-09-01 to 2026-09-05/);
}

/**
 * The range the panel sent to the preview — its own date state (today and
 * yesterday), not the fixture range the preview answers with. An export or a
 * save must send exactly this object.
 */
function rangeSentToThePreview(): unknown {
  return vi.mocked(reportsApi.fetchEnergyReportPreview).mock.calls[0]?.[0];
}

/** `KpiTile`'s label is a `span` in a flex row in the card, so the card is its grandparent. */
async function tileLabelled(label: string): Promise<HTMLElement> {
  const card = (await screen.findByText(label)).parentElement?.parentElement;
  expect(card, `no KpiTile is labelled ${JSON.stringify(label)}`).toBeTruthy();
  return card as HTMLElement;
}

/** A measured ratio renders to two decimals. */
export async function aMeasuredRatioRendersInTheReportsPanel(): Promise<void> {
  renderPanel(1.42);

  const tile = await tileLabelled("PUE");
  expect(await within(tile).findByText("1.42")).toBeInTheDocument();
  expect(within(tile).getByText(MEASURED_HINT)).toBeInTheDocument();
}

/** Nothing configured: the same dash the CSV export writes, and the reason. */
export async function anUnconfiguredPreviewShowsTheDashAndTheReason(): Promise<void> {
  renderPanel(null);

  const tile = await tileLabelled("PUE");
  expect(await within(tile).findByText("—")).toBeInTheDocument();
  expect(within(tile).getByText(NOT_CONFIGURED)).toBeInTheDocument();
}

/** `E4.1c` — the cost tile is the `Intl` string for the organization's currency. */
export async function aCostRendersInTheReportsPanel(): Promise<void> {
  renderPanel(1.25);

  const expected = new Intl.NumberFormat(undefined, { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(
    5042.12,
  );
  const tile = await tileLabelled("Indicative cost");
  // Raw `textContent`: `Intl` separates the symbol and the digits with U+00A0.
  await waitFor(() => expect(tile.textContent).toContain(expected));
}

/** `E4.1c` — the owed guard: a null cost renders the dash without throwing. */
export async function aNullCostRendersTheDashInTheReportsPanel(): Promise<void> {
  renderPanel(1.25, { indicativeCost: null, tariffPerKwh: null, currency: null });

  const tile = await tileLabelled("Indicative cost");
  expect(await within(tile).findByText("—")).toBeInTheDocument();
  expect(within(tile).getByText(/No tariff/)).toBeInTheDocument();
}

/**
 * `F3.5a` R-13 — a viewer sees the PDF button (the export routes are
 * `readableAssetIds`-scoped, like CSV) and neither the Save block nor the
 * History list. "Export PDF" is the positive control for the two absences.
 */
export async function aViewerSeesThePdfButtonAndNoSaveOrHistory(): Promise<void> {
  renderPanel(1.25);
  await previewResolved();

  expect(screen.getByRole("button", { name: "Export PDF" })).toBeInTheDocument();
  expect(screen.queryByText("Save to history")).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "History" })).not.toBeInTheDocument();
}

/**
 * `F3.5b` R-18 — a viewer sees no Schedules heading (the section shares the
 * History gate); "Export PDF" is the positive control.
 */
export async function aViewerSeesNoSchedulesHeading(): Promise<void> {
  renderPanel(1.25);
  await previewResolved();

  expect(screen.getByRole("button", { name: "Export PDF" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Schedules" })).not.toBeInTheDocument();
}

/** `F3.5b` R-18 — an `asset_group_admin` sees no Schedules heading either (the browser pass's third user). */
export async function anAssetGroupAdminSeesNoSchedulesHeading(): Promise<void> {
  renderPanel(1.25, {}, userWithRole("asset_group_admin"));
  await previewResolved();

  expect(screen.getByRole("button", { name: "Export PDF" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Schedules" })).not.toBeInTheDocument();
}

/** `F3.5b` R-18 — an admin sees the Schedules heading. */
export async function anAdminSeesTheSchedulesHeading(): Promise<void> {
  renderPanel(1.25, {}, userWithRole("admin"));
  await previewResolved();

  expect(screen.getByRole("heading", { name: "Schedules" })).toBeInTheDocument();
}

/** `F3.5a` — the deferred pill is gone; the preview heading is the positive control. */
export async function theDeferredPillIsGoneAndTheCardNamesThreeFormats(): Promise<void> {
  renderPanel(1.25);
  await previewResolved();

  expect(screen.getByText("Energy Consumption Preview")).toBeInTheDocument();
  expect(screen.queryByText("PDF/XLSX deferred")).not.toBeInTheDocument();
  expect(screen.getByText("PDF · XLSX · CSV")).toBeInTheDocument();
}

/** `F3.5a` — "Export PDF" calls `downloadEnergyReportPdf` with the range. */
export async function exportPdfCallsTheApiWithTheRange(): Promise<void> {
  const download = vi.spyOn(reportsApi, "downloadEnergyReportPdf").mockResolvedValue();
  renderPanel(1.25);
  await previewResolved();

  const button = screen.getByRole("button", { name: "Export PDF" });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);

  await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
  expect(download.mock.calls[0]?.[0]).toEqual(rangeSentToThePreview());
}

/** `F3.5a` — a failed PDF export renders its own line, not the XLSX or CSV one. */
export async function aFailedPdfExportRendersItsOwnLine(): Promise<void> {
  vi.spyOn(reportsApi, "downloadEnergyReportPdf").mockRejectedValue(new Error("energy-report-pdf 500"));
  renderPanel(1.25);
  await previewResolved();

  const button = screen.getByRole("button", { name: "Export PDF" });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);

  expect(await screen.findByText("PDF export failed.")).toBeInTheDocument();
  expect(screen.queryByText("XLSX export failed.")).not.toBeInTheDocument();
}

/**
 * `F3.5a` R-13 — a global `admin` must name an organization: the select exists,
 * lists the fetched organizations, and Save stays disabled beside the
 * organization sentence until one is chosen. Asserted **after** the preview
 * resolves, because `saveBlockedReason` names the missing range first.
 */
export async function anAdminMustChooseAnOrganizationBeforeSaving(): Promise<void> {
  renderPanel(1.25, {}, userWithRole("admin"));
  await previewResolved();

  const select = await screen.findByLabelText("Organization");
  expect(await within(select).findByRole("option", { name: "ESKOM · Eskom SMOC" })).toBeInTheDocument();
  const save = screen.getByRole("button", { name: "Save to history" });
  expect(save).toBeDisabled();
  expect(screen.getByText(ORGANIZATION_SENTENCE)).toBeInTheDocument();

  await userEvent.selectOptions(select, ESKOM.id);

  await waitFor(() => expect(save).toBeEnabled());
  expect(screen.queryByText(ORGANIZATION_SENTENCE)).not.toBeInTheDocument();
}

/**
 * `F3.5a` R-13 — a `location_admin` sends no organization: no select, and Save
 * is enabled once the preview resolved. The History heading is the second
 * positive control for the role gate.
 */
export async function aLocationAdminSavesWithoutAnOrganizationSelect(): Promise<void> {
  renderPanel(1.25, {}, userWithRole("location_admin"));
  await previewResolved();

  expect(screen.queryByLabelText("Organization")).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Save to history" })).toBeEnabled());
  expect(screen.getByRole("heading", { name: "History" })).toBeInTheDocument();
}

/**
 * `F3.5a` — Save calls `saveEnergyReportFile(input, "pdf", undefined)` for a
 * `location_admin`, asserted by position so a swapped `format` /
 * `organizationId` pair reddens here, and renders the saved line.
 */
export async function saveCallsTheApiByPositionAndRendersTheSavedLine(): Promise<void> {
  const save = vi.spyOn(reportsApi, "saveEnergyReportFile").mockResolvedValue(SAVED);
  renderPanel(1.25, {}, userWithRole("location_admin"));
  await previewResolved();

  const button = screen.getByRole("button", { name: "Save to history" });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);

  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const call = save.mock.calls[0];
  expect(call?.[0]).toEqual(rangeSentToThePreview());
  expect(call?.[1]).toBe("pdf");
  expect(call?.[2]).toBeUndefined();
  expect(await screen.findByText(`Saved ${SAVED.filename} to history.`)).toBeInTheDocument();
}

/**
 * `F3.5a` — the admin path with a chosen organization and the `xlsx` format:
 * two non-undefined strings in the last two positions, so a swap cannot hide
 * behind `undefined`. The list refetches after the save (spy delta 1).
 */
export async function anAdminSaveSendsTheFormatAndTheOrganizationInOrder(): Promise<void> {
  const save = vi.spyOn(reportsApi, "saveEnergyReportFile").mockResolvedValue({ ...SAVED, format: "xlsx" });
  renderPanel(1.25, {}, userWithRole("admin"));
  await previewResolved();
  const list = vi.mocked(reportsApi.fetchReportFiles);

  await userEvent.selectOptions(await screen.findByLabelText("Organization"), ESKOM.id);
  await userEvent.selectOptions(screen.getByLabelText("Format"), "xlsx");
  const button = screen.getByRole("button", { name: "Save to history" });
  await waitFor(() => expect(button).toBeEnabled());
  const listCallsBefore = list.mock.calls.length;
  await userEvent.click(button);

  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const call = save.mock.calls[0];
  expect(call?.[1]).toBe("xlsx");
  expect(call?.[2]).toBe(ESKOM.id);
  await waitFor(() => expect(list.mock.calls.length).toBe(listCallsBefore + 1));
}

/** `F3.5a` — a refused save renders the API's own sentence (the 409 cap here). */
export async function aRefusedSaveRendersTheApiSentence(): Promise<void> {
  vi.spyOn(reportsApi, "saveEnergyReportFile").mockRejectedValue(
    new ApiError("On-demand report cap reached for this organization", 409),
  );
  renderPanel(1.25, {}, userWithRole("location_admin"));
  await previewResolved();

  const button = screen.getByRole("button", { name: "Save to history" });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);

  expect(await screen.findByText("On-demand report cap reached for this organization")).toBeInTheDocument();
}
