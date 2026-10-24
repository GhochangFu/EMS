import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { ReportFileDto } from "@bms/shared";

import * as organizationsApi from "../api/admin/organizations";
import * as reportsApi from "../api/reports";
import { ApiError } from "../lib/api-error";
import type { AuthUser } from "../stores/auth-store";
import { ReportFileSaveWizard } from "./report-file-save-wizard";

/**
 * `F4.280` (ADR 0099 decision 6, Amendment 8, Q8) — the Save-to-history block
 * as a one-step `WizardShell` on `reportFile.save`: Report → Review. The
 * `F3.5a` block's claims (ADR 0071 decisions 4, 11; Amendment 1 item 1),
 * ported to the steps. One claim per row. Vitest entry point: the sibling
 * `.test.tsx`.
 */

const ORGANIZATION_SENTENCE = "Choose an organization to file the report under.";
const RANGE = { startDate: "2026-09-01", endDate: "2026-09-05" };

const ESKOM = { id: "5c2c1b0e-2222-4a5b-8c4d-000000000010", code: "ESKOM", name: "Eskom SMOC", active: true, currency: "ZAR", timezone: "UTC", meta: null, createdAt: "2026-01-01T00:00:00.000Z" };

const SAVED: ReportFileDto = {
  id: "0f0a4a1e-1111-4a5b-8c4d-000000000001",
  organizationId: ESKOM.id,
  templateId: "energy_consumption",
  format: "pdf",
  periodStart: RANGE.startDate,
  periodEnd: RANGE.endDate,
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

const user = (role: AuthUser["role"]): AuthUser => ({ id: "9b1d2c3e-0000-4a5b-8c4d-000000000001", email: "someone@bms.local", displayName: "Someone", role });

function renderWizard(role: AuthUser["role"]): void {
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({ items: [ESKOM] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ReportFileSaveWizard input={RANGE} user={user(role)} hasPreview previewError={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const next = () => userEvent.click(screen.getByRole("button", { name: "Next" }));
const submit = () => userEvent.click(screen.getByRole("button", { name: "Submit" }));

/** R-13: a global `admin` who chose no organization reads the sentence on the Review card, and nothing is sent. */
export async function anAdminMustChooseAnOrganizationBeforeSaving(): Promise<void> {
  const save = vi.spyOn(reportsApi, "saveEnergyReportFile").mockResolvedValue(SAVED);
  renderWizard("admin");
  await within(await screen.findByLabelText("Organization")).findByRole("option", { name: "ESKOM · Eskom SMOC" });
  await next();
  await submit();
  expect([(await screen.findAllByText(ORGANIZATION_SENTENCE)).length > 0, save.mock.calls.length]).toEqual([true, 0]);
}

/** R-13: the admin's chosen organization is sent. */
export async function anAdminSaveSendsTheChosenOrganization(): Promise<void> {
  const save = vi.spyOn(reportsApi, "saveEnergyReportFile").mockResolvedValue({ ...SAVED, format: "xlsx" });
  renderWizard("admin");
  const select = await screen.findByLabelText("Organization");
  await within(select).findByRole("option", { name: "ESKOM · Eskom SMOC" });
  await userEvent.selectOptions(select, ESKOM.id);
  await userEvent.selectOptions(screen.getByLabelText("Format"), "xlsx");
  await next();
  await submit();
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect([save.mock.calls[0]?.[1], save.mock.calls[0]?.[2]]).toEqual(["xlsx", ESKOM.id]);
}

/** R-13: a `location_admin` has no organization select; the Format select is the control. */
export async function aLocationAdminSavesWithoutAnOrganizationSelect(): Promise<void> {
  renderWizard("location_admin");
  await screen.findByLabelText("Format");
  expect(screen.queryByLabelText("Organization")).not.toBeInTheDocument();
}

/** Submit posts the panel's range and the format, by key, and no organization for a `location_admin`. */
export async function submitPostsTheRangeAndTheFormatByKey(): Promise<void> {
  const save = vi.spyOn(reportsApi, "saveEnergyReportFile").mockResolvedValue(SAVED);
  renderWizard("location_admin");
  await screen.findByLabelText("Format");
  await next();
  await submit();
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0]).toEqual([{ startDate: RANGE.startDate, endDate: RANGE.endDate }, "pdf", undefined]);
}

/** A saved file renders the saved line. */
export async function aSavedFileRendersTheSavedLine(): Promise<void> {
  vi.spyOn(reportsApi, "saveEnergyReportFile").mockResolvedValue(SAVED);
  renderWizard("location_admin");
  await screen.findByLabelText("Format");
  await next();
  await submit();
  expect(await screen.findByText(`Saved ${SAVED.filename} to history.`)).toBeInTheDocument();
}

/** A refused save renders the API's own sentence. */
export async function aRefusedSaveRendersTheApiSentence(): Promise<void> {
  vi.spyOn(reportsApi, "saveEnergyReportFile").mockRejectedValue(new ApiError("On-demand report cap reached for this organization", 409));
  renderWizard("location_admin");
  await screen.findByLabelText("Format");
  await next();
  await submit();
  expect(await screen.findByText("On-demand report cap reached for this organization")).toBeInTheDocument();
}

/** Q14: the Review card says the file renders on Submit. */
export async function theReviewSaysTheFileRendersOnConfirm(): Promise<void> {
  renderWizard("location_admin");
  await screen.findByLabelText("Format");
  await next();
  expect(await screen.findByText(/the file is rendered when you confirm/)).toBeInTheDocument();
}
