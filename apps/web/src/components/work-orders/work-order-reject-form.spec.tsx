import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type { UserRole, WorkOrderListItem } from "@bms/shared";

import * as workOrdersApi from "../../api/work-orders";
import { WorkOrderRejectForm } from "./work-order-reject-form";

/** `E3.1` (ADR 0122 decision 6) — assertions for the reject form; `work-order-reject-form.test.tsx` is the Vitest entry (ADR 0014). */

const ROW: WorkOrderListItem = {
  id: "0f4e1d2c-0000-4000-8000-000000000001",
  assetId: "0f4e1d2c-0000-4000-8000-0000000000a1",
  alarmId: null,
  title: "Replace pump bearing",
  description: null,
  status: "resolved",
  priority: "medium",
  sortOrder: 0,
  assignedTo: null,
  createdBy: null,
  dueAt: null,
  resolvedAt: "2026-10-01T10:00:00.000Z",
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
      <WorkOrderRejectForm row={{ ...ROW, ...over }} role={role} onDone={onDone} />
    </QueryClientProvider>,
  );
}

export async function rejectIsDisabledUnderThreeCharacters(): Promise<void> {
  renderForm();
  const button = screen.getByRole("button", { name: "Reject and send back" });
  expect(button).toBeDisabled();
  expect(screen.getByText("The work order goes back to In progress.")).toBeTruthy();
  await userEvent.type(screen.getByLabelText("Reason for rejecting"), "ab");
  expect(button).toBeDisabled();
  await userEvent.clear(screen.getByLabelText("Reason for rejecting"));
  await userEvent.type(screen.getByLabelText("Reason for rejecting"), "   ");
  expect(button).toBeDisabled();
  await userEvent.type(screen.getByLabelText("Reason for rejecting"), "abc");
  expect(button).toBeEnabled();
}

export function rejectIsAbsentForAnOperatorAndAViewer(): void {
  for (const role of ["operator", "viewer"] as const) {
    const { unmount } = renderForm({}, role);
    expect(screen.queryByRole("form", { name: "Reject work order" })).toBeNull();
    expect(screen.queryByLabelText("Reason for rejecting")).toBeNull();
    unmount();
  }
}

export function rejectIsAbsentUnlessResolved(): void {
  for (const status of ["open", "assigned", "in_progress", "closed", "cancelled"] as const) {
    const { unmount } = renderForm({ status });
    expect(screen.queryByLabelText("Reason for rejecting")).toBeNull();
    unmount();
  }
  renderForm();
  expect(screen.getByRole("form", { name: "Reject work order" })).toBeTruthy();
}

export async function submitSendsTheTrimmedReasonAndCallsOnDone(): Promise<void> {
  const updated = { ...ROW, status: "in_progress" } as WorkOrderListItem;
  const reject = vi.spyOn(workOrdersApi, "rejectWorkOrder").mockResolvedValue(updated);
  const onDone = vi.fn();
  renderForm({}, "admin", onDone);
  await userEvent.type(screen.getByLabelText("Reason for rejecting"), "  Still leaking  ");
  await userEvent.click(screen.getByRole("button", { name: "Reject and send back" }));
  await waitFor(() => expect(reject).toHaveBeenCalledWith(ROW.id, "Still leaking"));
  await waitFor(() => expect(onDone).toHaveBeenCalledWith(updated));
}

export async function aRefusedRejectShowsTheSentence(): Promise<void> {
  vi.spyOn(workOrdersApi, "rejectWorkOrder").mockRejectedValue(
    new Error(JSON.stringify({ statusCode: 409, message: "Only a resolved work order can be rejected." })),
  );
  renderForm();
  await userEvent.type(screen.getByLabelText("Reason for rejecting"), "Still leaking");
  await userEvent.click(screen.getByRole("button", { name: "Reject and send back" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Only a resolved work order can be rejected.");
  expect(alert.textContent).not.toContain("statusCode");
}
