import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type { UserRole, WorkOrderListItem } from "@bms/shared";

import * as workOrdersApi from "../../api/work-orders";
import { WorkOrderCancelForm } from "./work-order-cancel-form";

/** `E3.1` (ADR 0122 decision 6.8) — assertions for the cancel form; `work-order-cancel-form.test.tsx` is the Vitest entry (ADR 0014). */

const ROW: WorkOrderListItem = {
  id: "0f4e1d2c-0000-4000-8000-000000000001",
  assetId: "0f4e1d2c-0000-4000-8000-0000000000a1",
  alarmId: null,
  title: "Replace pump bearing",
  description: null,
  status: "open",
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
  causeCode: null,
  approvedAt: null,
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-01T09:00:00.000Z",
  assetCode: "PMP-01",
  assetRtuName: "RTU 2",
  assetLocationName: "Plant A",
  assetName: "Pump One",
  siteName: "Plant A",
};

function renderForm(over: Partial<WorkOrderListItem> = {}, role: UserRole = "admin", onDone: (row: WorkOrderListItem) => void = () => undefined) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WorkOrderCancelForm row={{ ...ROW, ...over }} role={role} onDone={onDone} />
    </QueryClientProvider>,
  );
}

export async function cancelIsDisabledUnderThreeCharacters(): Promise<void> {
  renderForm();
  const button = screen.getByRole("button", { name: "Cancel work order" });
  expect(button).toBeDisabled();
  expect(screen.getByText("This cannot be undone.")).toBeTruthy();
  await userEvent.type(screen.getByLabelText("Reason for cancelling"), "ab");
  expect(button).toBeDisabled();
  await userEvent.clear(screen.getByLabelText("Reason for cancelling"));
  await userEvent.type(screen.getByLabelText("Reason for cancelling"), "   ");
  expect(button).toBeDisabled();
  await userEvent.type(screen.getByLabelText("Reason for cancelling"), "abc");
  expect(button).toBeEnabled();
}

export function cancelIsAbsentForAnOperatorAndAViewer(): void {
  for (const role of ["operator", "viewer"] as const) {
    const { unmount } = renderForm({}, role);
    expect(screen.queryByLabelText("Reason for cancelling")).toBeNull();
    unmount();
  }
}

export function cancelIsAbsentOnClosedAndCancelledAndPresentOnLiveStatuses(): void {
  for (const status of ["closed", "cancelled"] as const) {
    const { unmount } = renderForm({ status });
    expect(screen.queryByLabelText("Reason for cancelling")).toBeNull();
    unmount();
  }
  for (const status of ["open", "assigned", "in_progress", "resolved"] as const) {
    const { unmount } = renderForm({ status });
    expect(screen.getByRole("form", { name: "Cancel work order" })).toBeTruthy();
    unmount();
  }
}

export async function submitSendsTheTrimmedReasonAndCallsOnDone(): Promise<void> {
  const updated = { ...ROW, status: "cancelled" } as WorkOrderListItem;
  const cancel = vi.spyOn(workOrdersApi, "cancelWorkOrder").mockResolvedValue(updated);
  const onDone = vi.fn();
  renderForm({}, "admin", onDone);
  await userEvent.type(screen.getByLabelText("Reason for cancelling"), "  Duplicate ticket  ");
  await userEvent.click(screen.getByRole("button", { name: "Cancel work order" }));
  await waitFor(() => expect(cancel).toHaveBeenCalledWith(ROW.id, "Duplicate ticket"));
  await waitFor(() => expect(onDone).toHaveBeenCalledWith(updated));
}

export async function aRefusedCancelShowsTheSentence(): Promise<void> {
  vi.spyOn(workOrdersApi, "cancelWorkOrder").mockRejectedValue(
    new Error(JSON.stringify({ statusCode: 409, message: "A closed work order cannot be cancelled." })),
  );
  renderForm();
  await userEvent.type(screen.getByLabelText("Reason for cancelling"), "Duplicate ticket");
  await userEvent.click(screen.getByRole("button", { name: "Cancel work order" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("A closed work order cannot be cancelled.");
  expect(alert.textContent).not.toContain("statusCode");
}
