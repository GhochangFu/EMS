import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type { MaintenanceScheduleItem } from "@bms/shared";

import * as maintenanceApi from "../api/maintenance";
import { CREATED } from "./maintenance-schedule-wizard.spec";
import { MaintenanceScheduleToggleWizard } from "./maintenance-schedule-toggle-wizard";

/**
 * `F4.281` (ADR 0099 decision 6, Amendment 8 D3, Q16; owner ruling DC1) — a
 * schedule's Deactivate or Activate on the Schedule Centre as the direction's
 * stepper: Reason (optional) → Review, with `active` fixed by the direction.
 * One claim per row. Vitest entry point: the sibling `.test.tsx`.
 */

function renderToggle(item: MaintenanceScheduleItem): void {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("maintenance-schedule-toggle-wizard.spec: no fetch expected"))));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MaintenanceScheduleToggleWizard item={item} onCancel={() => undefined} onDone={() => undefined} />
    </QueryClientProvider>,
  );
}

const ok = () => vi.spyOn(maintenanceApi, "updateMaintenanceSchedule").mockResolvedValue(CREATED);

async function toReviewAndSubmit(dialogName: string, reason?: string): Promise<void> {
  const dialog = screen.getByRole("dialog", { name: dialogName });
  if (reason) await userEvent.type(within(dialog).getByRole("textbox", { name: "Reason" }), reason);
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
}

/** An active schedule mounts the deactivate stepper and sends `active: false` with the reason typed. */
export async function anActiveScheduleDeactivatesWithItsReason(): Promise<void> {
  const update = ok();
  renderToggle(CREATED);
  await toReviewAndSubmit("Deactivate a maintenance schedule", "Plant shut for the season");
  expect(update).toHaveBeenCalledWith({ id: CREATED.id, active: false, reason: "Plant shut for the season" });
}

/** The deactivate Review card is the red one and says what the change does. */
export async function theDeactivateReviewSaysWhatItDoes(): Promise<void> {
  renderToggle(CREATED);
  const dialog = screen.getByRole("dialog", { name: "Deactivate a maintenance schedule" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  expect(within(dialog).getByText(/leaves the default Schedule Centre list/)).toHaveTextContent(`"${CREATED.title}"`);
}

/** An inactive schedule mounts the activate stepper and sends `active: true`, with no reason when none is typed. */
export async function anInactiveScheduleActivates(): Promise<void> {
  const update = ok();
  renderToggle({ ...CREATED, active: false });
  await toReviewAndSubmit("Activate a maintenance schedule");
  expect(update).toHaveBeenCalledWith({ id: CREATED.id, active: true });
}

/** A refused update shows the server's sentence, not the JSON envelope (moved from the panel's `MS3`). */
export async function aRefusedUpdateShowsTheSentence(): Promise<void> {
  const sentence = "This schedule was changed by another user";
  vi.spyOn(maintenanceApi, "updateMaintenanceSchedule").mockRejectedValue(
    new Error(`{"statusCode":409,"message":"${sentence}","error":"Conflict"}`),
  );
  renderToggle(CREATED);
  await toReviewAndSubmit("Deactivate a maintenance schedule");
  const element = await screen.findByText(new RegExp(sentence));
  expect(element.textContent).not.toContain('{"');
}

/** A two-character reason (the route takes three or more) stays on the Reason step: Next checks the route's own body. */
export async function aTwoCharacterReasonStaysOnTheReasonStep(): Promise<void> {
  renderToggle(CREATED);
  const dialog = screen.getByRole("dialog", { name: "Deactivate a maintenance schedule" });
  await userEvent.type(within(dialog).getByRole("textbox", { name: "Reason" }), "ok");
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  expect(within(dialog).queryByRole("button", { name: "Submit" })).toBeNull();
  expect(within(dialog).getByRole("textbox", { name: "Reason" })).toHaveValue("ok");
}
