import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type { MaintenanceScheduleItem } from "@bms/shared";

import type { AssetRow } from "../api/assets";
import * as maintenanceApi from "../api/maintenance";
import { MaintenanceSchedulesPanel, priorityStyle } from "./maintenance-schedules-panel";

/**
 * `F3.65b` owner ruling R-f (2026-09-28) — the schedule template's priority
 * pill uses the same split as the work-orders page: `high` on the solid warning
 * line and the strong wash, `medium` on the soft line and the plain wash.
 *
 * Assertions live here; `maintenance-schedules-panel.test.tsx` is the Vitest
 * entry point (ADR 0014).
 */

export function highAndMediumPillsDiffer(): void {
  expect(priorityStyle("high")).not.toBe(priorityStyle("medium"));
}

export function highPillIsTheRuledStrongWarning(): void {
  expect(priorityStyle("high")).toBe("border-warning bg-warning-wash-strong text-warning-ink");
}

export function mediumPillIsTheRuledSoftWarning(): void {
  expect(priorityStyle("medium")).toBe("border-warning-line bg-warning-wash text-warning-ink");
}

/**
 * `F4.204` — the `api/maintenance` writers throw an `Error` whose message is the
 * whole response body, so a refusal read through `.message` showed
 * `{"statusCode":409,…}` in the panel. The create, convert and update sites read
 * it through `apiErrorMessage`; one case per site, each with its own sentence,
 * each finding the error element by that sentence.
 */

const ASSET = {
  id: "asset-1",
  code: "AHU-01",
  name: "Air Handler One",
  siteName: "Plant A",
} as unknown as AssetRow;

const SCHEDULE: MaintenanceScheduleItem = {
  id: "5c4e1d2c-0000-4000-8000-000000000001",
  templateId: "template-1",
  assetId: "asset-1",
  title: "Quarterly filter change",
  description: null,
  category: "preventive",
  generationMode: "calendar",
  ownerTeam: null,
  vendorName: null,
  complianceRef: null,
  triggerSummary: null,
  safetyCritical: false,
  priority: "medium",
  estimatedMinutes: 60,
  intervalDays: 90,
  nextDueAt: "2026-12-01T09:00:00.000Z",
  lastCompletedAt: null,
  dueState: "upcoming",
  assetCode: "AHU-01",
  assetName: "Air Handler One",
  siteName: "Plant A",
  activeWorkOrderId: null,
};

function envelope(sentence: string): Error {
  return new Error(`{"statusCode":409,"message":"${sentence}","error":"Conflict"}`);
}

async function renderPanel(): Promise<void> {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("maintenance-schedules-panel.spec: no fetch expected"))),
  );
  vi.spyOn(maintenanceApi, "fetchMaintenanceSchedules").mockResolvedValue({ items: [SCHEDULE] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MaintenanceSchedulesPanel assetOptions={[ASSET]} />
    </QueryClientProvider>,
  );
  await screen.findByText(SCHEDULE.title);
}

/** The element carrying the refusal, found by its sentence; it must not carry the JSON. */
async function expectTheSentenceNotTheEnvelope(sentence: string): Promise<void> {
  const element = await screen.findByText(new RegExp(sentence));
  expect(element.textContent).toContain(sentence);
  expect(element.textContent).not.toContain('{"');
}

const CREATE_SENTENCE = "A schedule with this title already exists for the asset";
const CONVERT_SENTENCE = "This schedule already has an open work order";
const UPDATE_SENTENCE = "This schedule was changed by another user";

export async function aRefusedCreateShowsTheSentence(): Promise<void> {
  vi.spyOn(maintenanceApi, "createMaintenanceSchedule").mockRejectedValue(envelope(CREATE_SENTENCE));
  await renderPanel();

  await userEvent.click(screen.getByRole("button", { name: "+ New Schedule" }));
  const dialog = await screen.findByRole("dialog", { name: "Create maintenance schedule" });
  await userEvent.type(within(dialog).getByLabelText("Schedule title"), "Monthly belt check");
  await userEvent.click(within(dialog).getByRole("button", { name: "Create schedule" }));

  await expectTheSentenceNotTheEnvelope(CREATE_SENTENCE);
}

export async function aRefusedConvertShowsTheSentence(): Promise<void> {
  vi.spyOn(maintenanceApi, "convertMaintenanceSchedule").mockRejectedValue(envelope(CONVERT_SENTENCE));
  await renderPanel();

  await userEvent.click(screen.getByRole("button", { name: "Generate WO" }));

  await expectTheSentenceNotTheEnvelope(CONVERT_SENTENCE);
}

export async function aRefusedUpdateShowsTheSentence(): Promise<void> {
  vi.spyOn(maintenanceApi, "updateMaintenanceSchedule").mockRejectedValue(envelope(UPDATE_SENTENCE));
  await renderPanel();

  await userEvent.click(screen.getByRole("button", { name: "Deactivate" }));

  await expectTheSentenceNotTheEnvelope(UPDATE_SENTENCE);
}
