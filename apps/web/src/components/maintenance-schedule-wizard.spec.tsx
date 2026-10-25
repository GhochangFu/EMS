import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type { MaintenanceScheduleItem } from "@bms/shared";

import type { AssetRow } from "../api/assets";
import * as maintenanceApi from "../api/maintenance";
import { MaintenanceScheduleWizard } from "./maintenance-schedule-wizard";

/**
 * `F4.281` (ADR 0099 decision 6, Amendment 8 Q16) — the Schedule Centre's
 * create form as the `maintenanceSchedule.create` stepper: Schedule → Cycle →
 * Details → Review. One claim per row. Vitest entry point: the sibling
 * `.test.tsx` (ADR 0014, ADR 0042 decision 2).
 */

export const MS_ASSET = {
  id: "30000000-0000-4000-8000-0000000000aa",
  code: "AHU-01",
  name: "Air Handler One",
  siteName: "Plant A",
} as unknown as AssetRow;

export const CREATED: MaintenanceScheduleItem = {
  id: "5c4e1d2c-0000-4000-8000-000000000009",
  templateId: "5c4e1d2c-0000-4000-8000-000000000010",
  assetId: MS_ASSET.id,
  title: "Monthly belt check",
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
  intervalDays: 30,
  nextDueAt: "2026-12-01T09:00:00.000Z",
  lastCompletedAt: null,
  dueState: "upcoming",
  assetCode: "AHU-01",
  assetName: "Air Handler One",
  siteName: "Plant A",
  activeWorkOrderId: null,
  active: true,
};

const onDone = vi.fn();

function renderWizard(): void {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("maintenance-schedule-wizard.spec: no fetch expected"))));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MaintenanceScheduleWizard assetOptions={[MS_ASSET]} onCancel={() => undefined} onDone={onDone} />
    </QueryClientProvider>,
  );
}

const dialog = () => screen.getByRole("dialog", { name: "Create maintenance schedule" });
const next = () => userEvent.click(within(dialog()).getByRole("button", { name: "Next" }));
const submit = () => userEvent.click(within(dialog()).getByRole("button", { name: "Submit" }));

/** Fills the three field steps and lands on Review. */
async function fillToReview(details: { safetyCritical?: boolean; complianceRef?: string } = {}): Promise<void> {
  await userEvent.type(within(dialog()).getByLabelText("Schedule title"), "Monthly belt check");
  await next();
  const interval = within(dialog()).getByLabelText("Interval days");
  await userEvent.clear(interval);
  await userEvent.type(interval, "30");
  await userEvent.clear(within(dialog()).getByLabelText("First due date"));
  await userEvent.type(within(dialog()).getByLabelText("First due date"), "2026-12-01");
  await next();
  if (details.complianceRef) await userEvent.type(within(dialog()).getByLabelText("Compliance ref"), details.complianceRef);
  if (details.safetyCritical) await userEvent.click(within(dialog()).getByLabelText("Safety-critical"));
  await next();
}

/** The steps are the entry's: Schedule, Cycle, Details, then Review. */
export function theStepsAreTheEntrys(): void {
  renderWizard();
  const steps = within(dialog()).getByRole("list", { name: "Steps" });
  expect(within(steps).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    "1. Schedule",
    "2. Cycle",
    "3. Details",
    "4. Review",
  ]);
}

/** Submit sends the route's body: the typed fields, the defaults, and `firstDueAt` as an instant. */
export async function submitSendsTheRoutesBody(): Promise<void> {
  const create = vi.spyOn(maintenanceApi, "createMaintenanceSchedule").mockResolvedValue(CREATED);
  renderWizard();
  await fillToReview();
  await submit();
  expect(create).toHaveBeenCalledTimes(1);
  expect(create.mock.calls[0]?.[0]).toEqual({
    assetId: MS_ASSET.id,
    title: "Monthly belt check",
    category: "preventive",
    generationMode: "calendar",
    priority: "medium",
    intervalDays: 30,
    firstDueAt: new Date("2026-12-01T09:00:00").toISOString(),
    estimatedMinutes: 60,
    safetyCritical: false,
  });
}

/** The Review sentence names safety-critical and the compliance ref when they are set. */
export async function theReviewNamesSafetyAndCompliance(): Promise<void> {
  renderWizard();
  await fillToReview({ safetyCritical: true, complianceRef: "IS 2026" });
  expect(within(dialog()).getByText(/safety-critical/)).toHaveTextContent('compliance ref "IS 2026"');
}

/** A refused create shows the server's sentence, not the JSON envelope (moved from the panel's `MS1`). */
export async function aRefusedCreateShowsTheSentence(): Promise<void> {
  const sentence = "A schedule with this title already exists for the asset";
  vi.spyOn(maintenanceApi, "createMaintenanceSchedule").mockRejectedValue(
    new Error(`{"statusCode":409,"message":"${sentence}","error":"Conflict"}`),
  );
  renderWizard();
  await fillToReview();
  await submit();
  const element = await within(dialog()).findByText(new RegExp(sentence));
  expect(element.textContent).not.toContain('{"');
}
