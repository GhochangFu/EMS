import { screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";

import { useWizardStore } from "../../stores/wizard-store";
import { answered, CONVERSATION_ID, openPanel, renderDock, send, stub } from "./copilot-dock.spec";

/**
 * `F4.245` / ADR 0099 Amendment 4 — the dock sends the wizards open on the
 * screen with each turn, read at send time, and hands a fill to the store
 * with the page the same turn opened, so the fill waits only there. Vitest
 * entry point: `copilot-dock-wizards.test.tsx` (jsdom).
 */

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const KEY_A = `dashboard.update /api/v1/dashboards/${A}`;
const WIZARD_A = { catalogId: "dashboard.update", params: { id: A } };
const FILL_A = { catalogId: "dashboard.update", params: { id: A }, stepId: "basics", values: { name: "Main" } };

/**
 * The wizard registers after the dock mounted: the dock reads the open list
 * when it sends. Mutation: send `[]` (or read the list at mount) → red.
 */
export async function aTurnNamesTheWizardsOpenAtSendTime(): Promise<void> {
  const stubs = stub();
  renderDock("admin");
  await openPanel();
  useWizardStore.getState().register(KEY_A, WIZARD_A);
  await send("name it Main");
  await waitFor(() => expect(stubs.turn).toHaveBeenCalledWith(CONVERSATION_ID, "name it Main", [], [WIZARD_A]));
}

/** Owner ruling (nav). Mutation: hand the fill over with no page → it is dropped (nothing is open). */
export async function aFillAfterOpenPageWaitsOnThatPage(): Promise<void> {
  const stubs = stub();
  stubs.turn.mockResolvedValue({ ...answered("open A", "Opened.", "/admin/dashboards/a"), fillStep: FILL_A });
  renderDock("admin");
  await openPanel();
  await send("open A and name it Main");
  await waitFor(() => expect(screen.getByTestId("router-path")).toHaveTextContent("/admin/dashboards/a"));
  expect(useWizardStore.getState().waiting).toMatchObject({ key: KEY_A, waitPath: "/admin/dashboards/a" });
}

/** Mutation: drop the dock's `leavePage` effect → the fill still waits after the user moved on. */
export async function aWaitingFillIsDroppedWhenTheUserMovesOn(): Promise<void> {
  const stubs = stub();
  stubs.turn
    .mockResolvedValueOnce({ ...answered("open A", "Opened.", "/admin/dashboards/a"), fillStep: FILL_A })
    .mockResolvedValueOnce(answered("alarms", "Opening the alarms.", "/alarms"));
  renderDock("admin");
  await openPanel();
  await send("open A and name it Main");
  await waitFor(() => expect(useWizardStore.getState().waiting).not.toBeNull());
  await send("show the alarms");
  await waitFor(() => expect(screen.getByTestId("router-path")).toHaveTextContent("/alarms"));
  expect(useWizardStore.getState().waiting).toBeNull();
}
