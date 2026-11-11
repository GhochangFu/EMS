import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type { WorkOrderTaskDto } from "@bms/shared";

import * as workOrdersApi from "../../api/work-orders";
import { WorkOrderChecklist } from "./work-order-checklist";

/** `E3.1` (ADR 0122 decision 4) — assertions for the detail drawer's checklist; `work-order-checklist.test.tsx` is the Vitest entry (ADR 0014). */

const WO = "0f4e1d2c-0000-4000-8000-000000000001";

function task(over: Partial<WorkOrderTaskDto>): WorkOrderTaskDto {
  return {
    id: "t1",
    title: "Isolate the pump",
    mandatory: false,
    result: "pending",
    note: null,
    sortOrder: 0,
    completedAt: null,
    completedBy: null,
    templateItemId: null,
    ...over,
  };
}

function renderList(tasks: WorkOrderTaskDto[], readOnly = false, onChanged: () => void = () => undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WorkOrderChecklist workOrderId={WO} tasks={tasks} readOnly={readOnly} onChanged={onChanged} />
    </QueryClientProvider>,
  );
}

export async function tickingAnItemSendsDoneAndCallsOnChanged(): Promise<void> {
  const update = vi.spyOn(workOrdersApi, "updateWorkOrderTask").mockResolvedValue(task({ result: "done" }));
  const onChanged = vi.fn();
  renderList([task({})], false, onChanged);
  await userEvent.click(screen.getByRole("checkbox", { name: "Isolate the pump" }));
  await waitFor(() => expect(update).toHaveBeenCalledWith(WO, "t1", { result: "done" }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
}

export async function untickingADoneItemSendsPending(): Promise<void> {
  const update = vi.spyOn(workOrdersApi, "updateWorkOrderTask").mockResolvedValue(task({}));
  renderList([task({ result: "done" })]);
  const box = screen.getByRole("checkbox", { name: "Isolate the pump" });
  expect(box).toBeChecked();
  await userEvent.click(box);
  await waitFor(() => expect(update).toHaveBeenCalledWith(WO, "t1", { result: "pending" }));
}

export function mandatoryItemsAreMarkedAndTheCountIsShown(): void {
  renderList([
    task({ id: "t1", mandatory: true }),
    task({ id: "t2", title: "Log the reading", result: "done" }),
    task({ id: "t3", title: "Skip me", result: "not_applicable" }),
  ]);
  expect(screen.getAllByText("Mandatory")).toHaveLength(1);
  expect(screen.getByText("2 of 3 done")).toBeTruthy();
  expect(screen.getAllByText("Not applicable").length).toBeGreaterThan(0);
}

export async function notApplicableSendsItsResultAndResetSendsPending(): Promise<void> {
  const update = vi.spyOn(workOrdersApi, "updateWorkOrderTask").mockResolvedValue(task({}));
  renderList([task({})]);
  await userEvent.click(screen.getByRole("button", { name: "Not applicable" }));
  await waitFor(() => expect(update).toHaveBeenCalledWith(WO, "t1", { result: "not_applicable" }));
  update.mockClear();
  renderList([task({ id: "t9", title: "Other", result: "not_applicable" })]);
  await userEvent.click(screen.getByRole("button", { name: "Reset" }));
  await waitFor(() => expect(update).toHaveBeenCalledWith(WO, "t9", { result: "pending" }));
}

export async function addingAnItemSendsItsTitleAndClearsTheInput(): Promise<void> {
  const add = vi.spyOn(workOrdersApi, "addWorkOrderTask").mockResolvedValue(task({ id: "t2", title: "Torque check" }));
  const onChanged = vi.fn();
  renderList([], false, onChanged);
  expect(screen.getByText("No checklist items.")).toBeTruthy();
  const button = screen.getByRole("button", { name: "Add item" });
  expect(button).toBeDisabled();
  const input = screen.getByLabelText("New checklist item");
  await userEvent.type(input, " a ");
  expect(button).toBeDisabled();
  await userEvent.clear(input);
  await userEvent.type(input, "Torque check");
  await userEvent.click(screen.getByLabelText("Mandatory item"));
  expect(button).toBeEnabled();
  await userEvent.click(button);
  await waitFor(() => expect(add).toHaveBeenCalledWith(WO, { title: "Torque check", mandatory: true }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
}

export function readOnlyDisablesEveryControlAndHidesTheAddForm(): void {
  renderList([task({})], true);
  const section = screen.getByRole("region", { name: "Checklist" });
  for (const control of within(section).getAllByRole("checkbox")) expect(control).toBeDisabled();
  for (const control of within(section).getAllByRole("button")) expect(control).toBeDisabled();
  expect(screen.queryByLabelText("New checklist item")).toBeNull();
  expect(screen.queryByRole("button", { name: "Add item" })).toBeNull();
  expect(screen.getByText("The checklist is locked once the work order is resolved.")).toBeTruthy();
}

export async function aRefusedWriteShowsTheSentence(): Promise<void> {
  vi.spyOn(workOrdersApi, "updateWorkOrderTask").mockRejectedValue(
    new Error(JSON.stringify({ statusCode: 409, message: "The checklist is closed to changes." })),
  );
  renderList([task({})]);
  await userEvent.click(screen.getByRole("checkbox", { name: "Isolate the pump" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("The checklist is closed to changes.");
  expect(alert.textContent).not.toContain("statusCode");
}
