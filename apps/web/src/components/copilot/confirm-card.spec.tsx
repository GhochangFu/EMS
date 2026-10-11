import { focusManager, QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { CopilotPendingChangeDto } from "@bms/shared";

import * as templatesApi from "../../api/admin/dashboard-templates";
import * as copilotApi from "../../api/copilot";
import * as confirmApi from "../../api/copilot-confirm";
import { ApiError } from "../../lib/api-error";
import { useWizardStore } from "../../stores/wizard-store";
import { answered, CONVERSATION_ID, message, openPanel, renderDock, send, settle, stub } from "./copilot-dock.spec";
import { CHANGE_GONE_SENTENCE } from "./confirm-card";

/**
 * `F3.85` PR 8 / ADR 0099 decision 4 (plan §10.3) — the Confirm card in the
 * dock. Assertions here; `confirm-card.test.tsx` is the Vitest entry point
 * (jsdom). Every API read and write is a spy (an unstubbed fetch reaches
 * `:4000`, `F4.160`). The executor's own request shape (the body string, the
 * header) is `api/copilot-confirm.spec.ts`.
 */

const TEMPLATE = "33333333-3333-4333-8333-333333333333";

function change(over: Partial<CopilotPendingChangeDto> = {}): CopilotPendingChangeDto {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    catalogId: "dashboardTemplate.publish",
    method: "POST",
    path: `/api/v1/admin/dashboard-templates/${TEMPLATE}/publish`,
    body: {},
    summary: 'Publish the dashboard template "Feeder".',
    risk: "edit",
    proposedAt: "2026-10-11T10:00:00.000Z",
    expiresAt: "2026-10-11T10:15:00.000Z",
    ...over,
  };
}

async function proposed(pending: CopilotPendingChangeDto): Promise<ReturnType<typeof stub>> {
  const stubs = stub();
  stubs.turn.mockResolvedValueOnce(answered("publish Feeder", "Confirm the card to publish it.", null, [pending]));
  renderDock("admin");
  await openPanel();
  await send("publish Feeder");
  return stubs;
}

/** A proposal renders as a card naming the change; Confirm sends that change and the card goes. */
export async function confirmSendsTheProposedChange(): Promise<void> {
  const pending = change();
  const sent = vi.spyOn(confirmApi, "confirmCopilotChange").mockResolvedValue({ id: TEMPLATE });
  const reject = vi.spyOn(copilotApi, "rejectCopilotChange");
  const invalidated = vi.spyOn(QueryClient.prototype, "invalidateQueries");
  const reload = vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue({
    id: CONVERSATION_ID,
    organizationId: null,
    title: null,
    createdAt: "2026-10-11T10:00:00.000Z",
    lastTurnAt: "2026-10-11T10:00:00.000Z",
    messages: [message("user", "publish Feeder", 1), message("assistant", "Confirm the card to publish it.", 2)],
    pendingChanges: [],
  });
  await proposed(pending);
  const card = await screen.findByRole("region", { name: "Publish a dashboard template" });
  expect(within(card).getByText(pending.summary)).toBeTruthy();
  fireEvent.click(within(card).getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
  expect(sent.mock.calls[0]?.[0]).toEqual(pending);
  // The entry's query keys are made stale (lib/copilot-invalidations).
  await waitFor(() =>
    expect(invalidated.mock.calls.map((call) => (call[0] as { queryKey?: unknown }).queryKey)).toEqual(
      expect.arrayContaining([
        ["admin", "dashboard-templates"],
        ["admin", "dashboard-template"],
      ]),
    ),
  );
  await waitFor(() => expect(screen.queryByRole("region", { name: "Publish a dashboard template" })).toBeNull());
  expect(await screen.findByText("Applied. Waiting for the copilot…")).toBeTruthy();
  // The follow-up poll reads the conversation.
  await waitFor(() => expect(reload).toHaveBeenCalled(), { timeout: 4_000 });
  expect(reject).not.toHaveBeenCalled();
}

/**
 * The poll stops on the follow-up's outcome line, and shows its reply and its
 * next card (review #7): the indicator goes, Send comes back, and the reads
 * stop. While it waits, Send waits too (review #2). It polls with the window
 * unfocused (a user who switched tab after Confirm — found in the step-6
 * browser run, where TanStack Query paused the interval in a hidden tab).
 */
export async function thePollStopsOnTheFollowUpsOutcome(): Promise<void> {
  const pending = change();
  vi.spyOn(confirmApi, "confirmCopilotChange").mockResolvedValue({ id: TEMPLATE });
  const next = change({ id: "55555555-5555-4555-8555-555555555555", summary: 'Archive the dashboard template "Old".' });
  const before = [message("user", "publish Feeder", 1), message("assistant", "Confirm the card to publish it.", 2)];
  const reload = vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue({
    id: CONVERSATION_ID,
    organizationId: null,
    title: null,
    createdAt: "2026-10-11T10:00:00.000Z",
    lastTurnAt: "2026-10-11T10:00:00.000Z",
    messages: before,
    pendingChanges: [],
  });
  await proposed(pending);
  const card = await screen.findByRole("region", { name: "Publish a dashboard template" });
  fireEvent.change(screen.getByRole("textbox", { name: "Message the copilot" }), { target: { value: "thanks" } });
  focusManager.setFocused(false);
  fireEvent.click(within(card).getByRole("button", { name: "Confirm" }));
  // Waiting: Send is held, under its own name.
  const waiting = await screen.findByRole("button", { name: "Waiting…" });
  expect((waiting as HTMLButtonElement).disabled).toBe(true);
  await waitFor(() => expect(reload).toHaveBeenCalled(), { timeout: 4_000 });
  // The follow-up lands: its outcome line, its reply and its next card.
  reload.mockResolvedValue({
    id: CONVERSATION_ID,
    organizationId: null,
    title: null,
    createdAt: "2026-10-11T10:00:00.000Z",
    lastTurnAt: "2026-10-11T10:00:00.000Z",
    messages: [...before, message("action", `Applied: ${pending.summary}`, 3), message("assistant", "Published. Archive Old next?", 4)],
    pendingChanges: [next],
  });
  expect(await screen.findByText("Published. Archive Old next?", undefined, { timeout: 5_000 })).toBeTruthy();
  expect(await screen.findByRole("region", { name: "Publish a dashboard template" })).toBeTruthy();
  await waitFor(() => expect(screen.queryByText("Applied. Waiting for the copilot…")).toBeNull());
  expect(await screen.findByRole("button", { name: "Send" })).toBeTruthy();
  const reads = reload.mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 2_500));
  expect(reload.mock.calls.length).toBe(reads);
  focusManager.setFocused(undefined);
}

/** A 409 says the change is gone, closes the card and reloads the conversation. */
export async function a409SaysTheChangeIsGone(): Promise<void> {
  vi.spyOn(confirmApi, "confirmCopilotChange").mockRejectedValue(new ApiError("conflict", 409));
  const reload = vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue({
    id: CONVERSATION_ID,
    organizationId: null,
    title: null,
    createdAt: "2026-10-11T10:00:00.000Z",
    lastTurnAt: "2026-10-11T10:00:00.000Z",
    messages: [],
    pendingChanges: [],
  });
  await proposed(change());
  const card = await screen.findByRole("region", { name: "Publish a dashboard template" });
  fireEvent.click(within(card).getByRole("button", { name: "Confirm" }));
  expect(await screen.findByText(CHANGE_GONE_SENTENCE)).toBeTruthy();
  await waitFor(() => expect(reload).toHaveBeenCalled());
}

/** Another error shows on the card and keeps it open. */
export async function anErrorShowsOnTheCard(): Promise<void> {
  vi.spyOn(confirmApi, "confirmCopilotChange").mockRejectedValue(
    new ApiError(JSON.stringify({ message: "A template with no widgets cannot be published", statusCode: 400 }), 400),
  );
  await proposed(change());
  const card = await screen.findByRole("region", { name: "Publish a dashboard template" });
  fireEvent.click(within(card).getByRole("button", { name: "Confirm" }));
  expect(await within(card).findByText("A template with no widgets cannot be published")).toBeTruthy();
  expect(within(card).getByRole("button", { name: "Confirm" })).toBeTruthy();
}

/** Reject calls the reject route, never the change's own route, and shows the stored line. */
export async function rejectCallsTheRejectRouteOnly(): Promise<void> {
  const pending = change();
  const sent = vi.spyOn(confirmApi, "confirmCopilotChange");
  const reject = vi.spyOn(copilotApi, "rejectCopilotChange").mockResolvedValue({
    id: pending.id,
    status: "rejected",
    messages: [message("action", `Rejected: ${pending.summary}`, 3)],
  });
  await proposed(pending);
  const card = await screen.findByRole("region", { name: "Publish a dashboard template" });
  fireEvent.click(within(card).getByRole("button", { name: "Reject" }));
  await waitFor(() => expect(reject).toHaveBeenCalledWith(pending.id));
  expect(await screen.findByText(`Rejected: ${pending.summary}`)).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole("region", { name: "Publish a dashboard template" })).toBeNull());
  await settle();
  expect(sent).not.toHaveBeenCalled();
}

/** A deactivating change is styled red. */
export async function anArchiveCardIsRed(): Promise<void> {
  await proposed(
    change({
      catalogId: "dashboardTemplate.archive",
      path: `/api/v1/admin/dashboard-templates/${TEMPLATE}/archive`,
      risk: "deactivate",
      summary: 'Archive the dashboard template "Feeder".',
    }),
  );
  const card = await screen.findByRole("region", { name: "Archive a dashboard template" });
  expect(card.getAttribute("data-risk")).toBe("deactivate");
  expect(within(card).getByRole("button", { name: "Confirm" }).className).toContain("text-critical-ink");
}

/** An edit card compares with the record now, read as it renders, and states the proposal time. */
export async function anEditCardComparesWithTheRecordNow(): Promise<void> {
  const current = vi
    .spyOn(templatesApi, "fetchAdminDashboardTemplate")
    .mockResolvedValue({ name: "Feeder", section: "electrical", description: null, content: {} } as never);
  await proposed(
    change({
      catalogId: "dashboardTemplate.update",
      method: "PATCH",
      path: `/api/v1/admin/dashboard-templates/${TEMPLATE}`,
      body: { name: "Feeder v2" },
      summary: 'Change name of the dashboard template "Feeder".',
    }),
  );
  const card = await screen.findByRole("region", { name: "Edit a dashboard template" });
  expect(await within(card).findByRole("columnheader", { name: "Now" })).toBeTruthy();
  expect(within(card).getByText("Feeder")).toBeTruthy();
  expect(within(card).getByText("Feeder v2")).toBeTruthy();
  expect(within(card).getByText(/The record can change before you confirm/)).toBeTruthy();
  expect(current).toHaveBeenCalledWith(TEMPLATE);
}

/** A create card reads no record: there is nothing to compare. */
export async function aCreateCardReadsNoRecord(): Promise<void> {
  const current = vi.spyOn(templatesApi, "fetchAdminDashboardTemplate");
  await proposed(
    change({
      catalogId: "dashboardTemplate.create",
      path: "/api/v1/admin/dashboard-templates",
      risk: "create",
      body: { organizationId: TEMPLATE, code: "f", name: "Feeder", section: "electrical" },
      summary: 'Create the dashboard template "Feeder" (f) in Org.',
    }),
  );
  const card = await screen.findByRole("region", { name: "Create a dashboard template" });
  expect(within(card).getByRole("columnheader", { name: "Value" })).toBeTruthy();
  expect(within(card).queryByRole("columnheader", { name: "Now" })).toBeNull();
  await settle();
  expect(current).not.toHaveBeenCalled();
}

/** A turn's `fillStep` goes to the wizard store for an open wizard. */
export async function aFillStepReachesTheWizardStore(): Promise<void> {
  const stubs = stub();
  const fill = { catalogId: "dashboard.create", stepId: "basics", values: { name: "Main" } };
  stubs.turn.mockResolvedValueOnce({ ...answered("name it Main", "Filled."), fillStep: fill });
  renderDock("admin");
  await openPanel();
  await send("name it Main");
  await waitFor(() => expect(useWizardStore.getState().fill).toEqual(fill));
}
