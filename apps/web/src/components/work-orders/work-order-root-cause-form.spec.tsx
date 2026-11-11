import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type { WorkOrderDetail } from "@bms/shared";

import * as workOrdersApi from "../../api/work-orders";
import { WorkOrderRootCauseForm } from "./work-order-root-cause-form";

/** `E3.1` (ADR 0122 decision 5) — assertions for the detail drawer's root-cause form; `work-order-root-cause-form.test.tsx` is the Vitest entry (ADR 0014). */

const WO = "0f4e1d2c-0000-4000-8000-000000000001";

const DETAIL: WorkOrderDetail = {
  id: WO,
  assetId: "0f4e1d2c-0000-4000-8000-0000000000a1",
  alarmId: null,
  title: "Replace pump bearing",
  description: null,
  status: "in_progress",
  priority: "medium",
  sortOrder: 0,
  assignedTo: null,
  createdBy: null,
  dueAt: null,
  resolvedAt: null,
  closedAt: null,
  reference: "GEN-000001",
  slaMinutes: null,
  slaDueAt: null,
  slaState: "none",
  checklistDone: 0,
  checklistTotal: 0,
  causeCode: "bearing_wear",
  approvedAt: null,
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-01T09:00:00.000Z",
  assetCode: "PMP-01",
  assetRtuName: "RTU 2",
  assetLocationName: "Plant A",
  assetName: "Pump One",
  siteName: "Plant A",
  events: [],
  alarm: null,
  tasks: [],
  rootCause: "Worn bearing",
  correctiveAction: "Replaced bearing",
  preventiveAction: null,
  resolvedBy: null,
  approvedBy: null,
  cancelledBy: null,
  cancelledAt: null,
  alarmSnapshot: null,
};

function renderForm(over: Partial<WorkOrderDetail> = {}, readOnly = false, onSaved: () => void = () => undefined) {
  vi.spyOn(workOrdersApi, "fetchWorkOrderCauseCodes").mockResolvedValue({
    items: [
      { code: "bearing_wear", label: "Bearing wear", sortOrder: 1 },
      { code: "power_loss", label: "Power loss", sortOrder: 2 },
    ],
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WorkOrderRootCauseForm workOrderId={WO} detail={{ ...DETAIL, ...over }} readOnly={readOnly} onSaved={onSaved} />
    </QueryClientProvider>,
  );
}

const field = (name: string): HTMLInputElement => screen.getByLabelText(name) as HTMLInputElement;

export async function theFieldsStartFromTheDetail(): Promise<void> {
  renderForm();
  expect(field("Cause found").value).toBe("Worn bearing");
  expect(field("Corrective action").value).toBe("Replaced bearing");
  expect(field("Preventive action").value).toBe("");
  await screen.findByRole("option", { name: "Power loss" });
  expect(field("Cause code").value).toBe("bearing_wear");
  expect(screen.getByRole("option", { name: "Not set" })).toHaveValue("");
  expect(screen.getAllByRole("option", { name: "Bearing wear" })).toHaveLength(1);
}

export async function aRetiredCodeStaysSelectable(): Promise<void> {
  renderForm({ causeCode: "old_code" });
  await waitFor(() => expect(screen.getByRole("option", { name: "Power loss" })).toBeTruthy());
  expect(field("Cause code").value).toBe("old_code");
}

export async function saveSendsTrimmedValuesWithNullForAnEmptyOne(): Promise<void> {
  const put = vi.spyOn(workOrdersApi, "putWorkOrderRootCause").mockResolvedValue(DETAIL);
  const onSaved = vi.fn();
  renderForm({}, false, onSaved);
  const save = screen.getByRole("button", { name: "Save root cause" });
  expect(save).toBeDisabled();
  await userEvent.clear(field("Cause found"));
  await userEvent.type(field("Cause found"), "  Seal failed  ");
  await userEvent.clear(field("Corrective action"));
  await screen.findByRole("option", { name: "Power loss" });
  await userEvent.selectOptions(field("Cause code"), "");
  expect(save).toBeEnabled();
  await userEvent.click(save);
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(WO, {
      rootCause: "Seal failed",
      correctiveAction: null,
      preventiveAction: null,
      causeCode: null,
    }),
  );
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
}

export async function saveIsDisabledWhenAnEntryIsTooShort(): Promise<void> {
  renderForm();
  await userEvent.type(field("Preventive action"), "ab");
  expect(screen.getByRole("button", { name: "Save root cause" })).toBeDisabled();
  expect(screen.getByText("Each entry needs at least 3 characters.")).toBeTruthy();
  await userEvent.type(field("Preventive action"), "c");
  expect(screen.getByRole("button", { name: "Save root cause" })).toBeEnabled();
  expect(screen.queryByText("Each entry needs at least 3 characters.")).toBeNull();
}

export function readOnlyLocksTheFormAndHidesSave(): void {
  renderForm({ status: "closed" }, true);
  for (const name of ["Cause found", "Corrective action", "Preventive action", "Cause code"]) expect(field(name)).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Save root cause" })).toBeNull();
  expect(screen.getByText("The root cause is locked once the work order is closed.")).toBeTruthy();
}

export async function aRefusedSaveShowsTheSentence(): Promise<void> {
  vi.spyOn(workOrdersApi, "putWorkOrderRootCause").mockRejectedValue(
    new Error(JSON.stringify({ statusCode: 409, message: "The cause code is not in use." })),
  );
  renderForm();
  await userEvent.type(field("Preventive action"), "Grease monthly");
  await userEvent.click(screen.getByRole("button", { name: "Save root cause" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("The cause code is not in use.");
  expect(alert.textContent).not.toContain("statusCode");
}
