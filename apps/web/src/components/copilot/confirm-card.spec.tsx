import { focusManager, QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { CopilotPendingChangeDto } from "@bms/shared";
import { catalogEntry, COPILOT_CHANGE_REFUSED_MESSAGE, COPILOT_UNAVAILABLE_MESSAGE } from "@bms/shared/copilot";

import * as templatesApi from "../../api/admin/dashboard-templates";
import * as copilotApi from "../../api/copilot";
import * as confirmApi from "../../api/copilot-confirm";
import * as currentApi from "../../api/copilot-current";
import * as loginApi from "../../api/login";
import { ApiError } from "../../lib/api-error";
import { openWizardKey } from "../../lib/wizard-steps";
import { useAuthStore } from "../../stores/auth-store";
import { useCopilotStore } from "../../stores/copilot-store";
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

/** Exported for `copilot-dock-follow-up.spec.tsx` (`F4.244`). */
export function change(over: Partial<CopilotPendingChangeDto> = {}): CopilotPendingChangeDto {
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
    ifMatch: null,
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
  // `F3.86` PR 2: the interceptor's own refusal, by its sentence.
  vi.spyOn(confirmApi, "confirmCopilotChange").mockRejectedValue(
    new ApiError(JSON.stringify({ message: COPILOT_CHANGE_REFUSED_MESSAGE, statusCode: 409 }), 409),
  );
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

const EMPTY_CONVERSATION = {
  id: CONVERSATION_ID,
  organizationId: null,
  title: null,
  createdAt: "2026-10-11T10:00:00.000Z",
  lastTurnAt: "2026-10-11T10:00:00.000Z",
  messages: [],
  pendingChanges: [],
};

/**
 * A route's own error shows on the card with the route's sentence, and the
 * card closes: the server recorded the change `failed`, so a second Confirm
 * could only be refused (`F3.86` PR 2; release 1 left Confirm offered).
 */
export async function anErrorShowsOnTheCard(): Promise<void> {
  vi.spyOn(confirmApi, "confirmCopilotChange").mockRejectedValue(
    new ApiError(JSON.stringify({ message: "A template with no widgets cannot be published", statusCode: 400 }), 400),
  );
  const reload = vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue(EMPTY_CONVERSATION);
  await proposed(change());
  const card = await screen.findByRole("region", { name: "Publish a dashboard template" });
  fireEvent.click(within(card).getByRole("button", { name: "Confirm" }));
  expect(await within(card).findByText("A template with no widgets cannot be published")).toBeTruthy();
  expect(within(card).queryByRole("button", { name: "Confirm" })).toBeNull();
  // After the reload, which no longer lists the change, the card is still on screen (code review #1, #5).
  await waitFor(() => expect(reload).toHaveBeenCalled(), { timeout: 4_000 });
  const after = await screen.findByRole("region", { name: "Publish a dashboard template" });
  expect(within(after).getByText("A template with no widgets cannot be published")).toBeTruthy();
  expect(screen.getByText("Not applied. Waiting for the copilot…")).toBeTruthy();
}

/**
 * `F3.86` PR 2 — a route's own 409 is the route's answer, not "gone": its
 * sentence shows, the gone sentence does not, Confirm is no longer offered,
 * and the dock reloads the conversation once. Mutation: restore
 * `err.status === 409` alone as "gone" → this reddens.
 */
export async function aRoutesOwn409ShowsItsSentence(): Promise<void> {
  vi.spyOn(confirmApi, "confirmCopilotChange").mockRejectedValue(
    new ApiError(JSON.stringify({ message: "This site has no active assets to lay out", statusCode: 409 }), 409),
  );
  const reload = vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue(EMPTY_CONVERSATION);
  await proposed(change());
  const card = await screen.findByRole("region", { name: "Publish a dashboard template" });
  fireEvent.click(within(card).getByRole("button", { name: "Confirm" }));
  expect(await within(card).findByText("This site has no active assets to lay out")).toBeTruthy();
  expect(within(card).queryByText(CHANGE_GONE_SENTENCE)).toBeNull();
  expect(within(card).queryByRole("button", { name: "Confirm" })).toBeNull();
  // The dock waits for the follow-up turn and keeps the card past the reload (code review #1, #5).
  await waitFor(() => expect(reload).toHaveBeenCalled(), { timeout: 4_000 });
  const after = await screen.findByRole("region", { name: "Publish a dashboard template" });
  expect(within(after).getByText("This site has no active assets to lay out")).toBeTruthy();
  expect(within(after).queryByText(CHANGE_GONE_SENTENCE)).toBeNull();
}

/**
 * A 5xx (here the interceptor's own 500) may come before the claim, so the card stays
 * open with Confirm and Reject (code review #2). Mutation: treat a 5xx as a
 * route answer → Confirm disappears and this reddens.
 */
export async function a5xxKeepsTheCardOpen(): Promise<void> {
  vi.spyOn(confirmApi, "confirmCopilotChange").mockRejectedValue(
    new ApiError(JSON.stringify({ message: "The copilot request context is missing", statusCode: 500 }), 500),
  );
  await proposed(change());
  const card = await screen.findByRole("region", { name: "Publish a dashboard template" });
  fireEvent.click(within(card).getByRole("button", { name: "Confirm" }));
  expect(await within(card).findByText("The copilot request context is missing")).toBeTruthy();
  expect(within(card).getByRole("button", { name: "Confirm" })).toBeTruthy();
  expect(within(card).getByRole("button", { name: "Reject" })).toBeTruthy();
}

/** The copilot is not available now: nothing was claimed, so the card stays open with its sentence. */
export async function anUnavailableCopilotKeepsTheCardOpen(): Promise<void> {
  vi.spyOn(confirmApi, "confirmCopilotChange").mockRejectedValue(
    new ApiError(JSON.stringify({ message: COPILOT_UNAVAILABLE_MESSAGE, statusCode: 403 }), 403),
  );
  await proposed(change());
  const card = await screen.findByRole("region", { name: "Publish a dashboard template" });
  fireEvent.click(within(card).getByRole("button", { name: "Confirm" }));
  expect(await within(card).findByText(COPILOT_UNAVAILABLE_MESSAGE)).toBeTruthy();
  // An edit is not red: the control beside the access card's red Confirm.
  expect(within(card).getByRole("button", { name: "Confirm" }).className).not.toContain("text-critical-ink");
}

const SITE = "66666666-6666-4666-8666-666666666666";

/**
 * `F3.86` PR 2, ruling Q7(b) — a confirmed site layout that answers the
 * ambiguous 409 lists the candidate groups and links to the site page, where
 * the wizard asks for them. (`location.siteLayout.make` is mocked into the
 * catalog by the `.test.tsx` until PR 3d adds it.)
 */
export async function anAmbiguous409ListsTheCandidates(): Promise<void> {
  const ambiguous = {
    message: "Choose a group for each tab",
    ambiguous: [
      {
        tabKey: "sld",
        domain: "electrical",
        candidates: [
          { id: "77777777-7777-4777-8777-777777777777", code: "lv-a", name: "LV Board A" },
          { id: "88888888-8888-4888-8888-888888888888", code: "lv-b", name: "LV Board B" },
        ],
      },
    ],
  };
  vi.spyOn(confirmApi, "confirmCopilotChange").mockRejectedValue(new ApiError(JSON.stringify(ambiguous), 409));
  vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue(EMPTY_CONVERSATION);
  await proposed(
    change({
      catalogId: "location.siteLayout.make",
      path: `/api/v1/admin/locations/${SITE}/site-layout`,
      risk: "create",
      summary: "Make the site layout of Site 6.",
    }),
  );
  const card = await screen.findByRole("region", { name: "Make the site layout" });
  fireEvent.click(within(card).getByRole("button", { name: "Confirm" }));
  await screen.findByRole("region", { name: "Groups to choose" });
  // Read after the reload has run, so the list is the one still mounted (code review #5).
  await waitFor(() => expect(copilotApi.fetchCopilotConversation).toHaveBeenCalled(), { timeout: 4_000 });
  await settle();
  const groups = screen.getByRole("region", { name: "Groups to choose" });
  expect(within(groups).getByText(/LV Board A, LV Board B/)).toBeTruthy();
  const link = within(groups).getByRole("link", { name: "Choose the groups on the site page" });
  expect(link.getAttribute("href")).toBe(`/control-room/site/${SITE}`);
  expect(screen.queryByText(CHANGE_GONE_SENTENCE)).toBeNull();
}

const PASSWORD = "typed-on-the-card-9";

/**
 * `F3.86` PR 2 / ADR 0099 decision 3 — a `clientOnly` field is a password box
 * on the card. Confirm waits until the value parses with the field's own
 * schema; the value goes to the executor beside the stored body and never
 * into the stored change or the dock's store. (`fixture.user.create` is
 * mocked into the catalog by the `.test.tsx` until PR 4 adds `user.create`.)
 */
export async function aClientOnlyFieldIsTypedOnTheCard(): Promise<void> {
  const sent = vi.spyOn(confirmApi, "confirmCopilotChange").mockResolvedValue({ id: "user-1" });
  const pending = change({
    catalogId: "fixture.user.create",
    path: "/api/v1/admin/users",
    body: { email: "new@example.test", displayName: "New", role: "viewer", organizationId: "99999999-9999-4999-8999-999999999999" },
    risk: "access",
    summary: "Create the user new@example.test.",
  });
  const stored = JSON.parse(JSON.stringify(pending.body)) as unknown;
  await proposed(pending);
  const card = await screen.findByRole("region", { name: "Create a user" });
  const confirm = within(card).getByRole("button", { name: "Confirm" }) as HTMLButtonElement;
  // An access change is red (decision 3), like a deactivation.
  expect(card.getAttribute("data-risk")).toBe("access");
  expect(confirm.className).toContain("text-critical-ink");
  expect(confirm.disabled).toBe(true);
  const box = within(card).getByLabelText("Temporary password") as HTMLInputElement;
  expect(box.type).toBe("password");
  fireEvent.change(box, { target: { value: "short" } });
  expect(confirm.disabled).toBe(true);
  expect(within(card).getByText(/at least 12/i)).toBeTruthy();
  fireEvent.change(box, { target: { value: PASSWORD } });
  expect(confirm.disabled).toBe(false);
  fireEvent.click(confirm);
  await waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
  expect(sent.mock.calls[0]?.[1]).toEqual({ temporaryPassword: PASSWORD });
  expect(sent.mock.calls[0]?.[0].body).toEqual(stored);
  expect(JSON.stringify(useCopilotStore.getState())).not.toContain(PASSWORD);
  expect(JSON.stringify({ ...window.localStorage })).not.toContain(PASSWORD);
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

/**
 * `F4.246` (ADR 0099 §3) — the card passes the entry's `formulas` to `changeRows`, so a template
 * edit's derived point gets its own full-text formula row. Mutation: drop that argument in
 * `confirm-card.tsx` → this reddens.
 */
export async function aTemplateEditCardShowsTheFormulaRow(): Promise<void> {
  vi.spyOn(currentApi, "fetchCopilotCurrent").mockResolvedValue(null);
  await proposed(
    change({
      catalogId: "assetTemplate.update",
      method: "PATCH",
      path: `/api/v1/admin/asset-templates/${TEMPLATE}`,
      body: {
        points: [
          { pointKey: "kw", kind: "measured" },
          { pointKey: "eff", kind: "derived", formula: "{kw} * 2", formulaDialect: "bms-calc-v1", calcTrigger: "streaming" },
        ],
      },
      summary: 'Change points of the asset template "Pump".',
    }),
  );
  const card = await screen.findByRole("region", { name: "Edit an asset template" });
  expect(within(card).getByRole("rowheader", { name: "Formula eff (points)" })).toBeTruthy();
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

const LOCATION = "77777777-7777-4777-8777-777777777777";
const PARENT = "88888888-8888-4888-8888-888888888888";
const TOKEN = "tok-copilot-scope";

/**
 * Confirms one location change and waits for the dock's "Applied" line, which
 * follows the refresh: an absence read before it would prove nothing.
 */
async function confirmLocationChange(pending: CopilotPendingChangeDto, title: string): Promise<{ mock: { calls: unknown[][] } }> {
  useAuthStore.setState({ accessToken: TOKEN });
  // An edit card reads the record now; the read is not under test here.
  vi.spyOn(currentApi, "fetchCopilotCurrent").mockResolvedValue(null);
  const sent = vi.spyOn(confirmApi, "confirmCopilotChange").mockResolvedValue({ id: LOCATION });
  vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue(EMPTY_CONVERSATION);
  const refresh = vi.spyOn(loginApi, "refreshScope").mockResolvedValue(undefined);
  await proposed(pending);
  const card = await screen.findByRole("region", { name: title });
  fireEvent.click(within(card).getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("Applied. Waiting for the copilot…")).toBeTruthy();
  return refresh;
}

function locationChange(over: Partial<CopilotPendingChangeDto>): CopilotPendingChangeDto {
  return change({ method: "PATCH", path: `/api/v1/admin/locations/${LOCATION}`, ...over });
}

/**
 * `F3.86` PR 3a review (ADR 0098 B8) — a location the copilot created makes the
 * stored scope stale, so Confirm refreshes it, as the locations page does.
 * Mutation: drop the call → this reddens.
 */
export async function aCopilotLocationCreateRefreshesTheScope(): Promise<void> {
  const refresh = await confirmLocationChange(
    locationChange({
      catalogId: "location.create",
      method: "POST",
      path: "/api/v1/admin/locations",
      risk: "create",
      body: { organizationId: LOCATION, code: "WC", slug: "wc", name: "West Campus", type: "rsmoc", latitude: 0, longitude: 0 },
      summary: 'Create the location "West Campus".',
    }),
    "Create a location",
  );
  expect(refresh.mock.calls).toEqual([[TOKEN]]);
}

/** A copilot move (an update naming `parentId`) refreshes the scope too. */
export async function aCopilotLocationMoveRefreshesTheScope(): Promise<void> {
  const refresh = await confirmLocationChange(
    locationChange({ catalogId: "location.update", body: { parentId: PARENT }, summary: 'Move the location "West Campus".' }),
    "Edit a location",
  );
  expect(refresh.mock.calls).toEqual([[TOKEN]]);
}

/**
 * A rename leaves the tree as it was: no refresh. Mutation: refresh on every
 * `location.update` → this reddens.
 */
export async function aCopilotLocationRenameKeepsTheScope(): Promise<void> {
  const refresh = await confirmLocationChange(
    locationChange({ catalogId: "location.update", body: { name: "East Campus" }, summary: 'Rename the location "West Campus".' }),
    "Edit a location",
  );
  expect(refresh.mock.calls).toEqual([]);
}

/** A turn's `fillStep` goes to the wizard store for an open wizard. */
export async function aFillStepReachesTheWizardStore(): Promise<void> {
  const stubs = stub();
  const fill = { catalogId: "dashboard.create", params: {}, stepId: "basics", values: { name: "Main" } };
  const key = openWizardKey(catalogEntry("dashboard.create")!, {});
  useWizardStore.getState().register(key!, { catalogId: "dashboard.create", params: {} });
  stubs.turn.mockResolvedValueOnce({ ...answered("name it Main", "Filled."), fillStep: fill });
  renderDock("admin");
  await openPanel();
  await send("name it Main");
  await waitFor(() => expect(useWizardStore.getState().waiting?.fill).toEqual(fill));
}

/**
 * `F4.278` (ADR 0099 Amendment 8 D3, Q9) — a `rule.disable` card is red, and the
 * server's check note (appended to the summary) reaches the card verbatim: no
 * card change carries it.
 */
export async function aRuleDisableCardIsRedAndShowsTheCheckNote(): Promise<void> {
  const rule = "55555555-5555-4555-8555-555555555555";
  const summary =
    'Disable the rule "Chiller high": it stops evaluating until it is enabled again. ' +
    "Condition: CH-01 supply_temp_c above 3 (latest value; clear hold 120 s).";
  await proposed(
    change({ catalogId: "rule.disable", method: "PATCH", path: `/api/v1/rules/${rule}/enabled`, body: { enabled: false }, summary, risk: "deactivate" }),
  );
  const card = await screen.findByRole("region", { name: "Disable an alarm rule" });
  expect(card.getAttribute("data-risk")).toBe("deactivate");
  expect(within(card).getByText(summary)).toBeTruthy();
}

const CHANNEL_ORG = "66666666-6666-4666-8666-666666666666";
const ADDRESS = "ops@example.test";

/** `F4.279`: a channel create card, as the server stores it (the recipients card-only). */
function channelCreate(kind: "email" | "webhook"): CopilotPendingChangeDto {
  return change({
    catalogId: "notificationChannel.create",
    path: "/api/v1/notifications/channels",
    risk: "create",
    body: {
      organizationId: CHANNEL_ORG,
      code: "ops",
      name: "Ops",
      kind,
      ...(kind === "email" ? { config: { to: [ADDRESS] } } : {}),
      recipients: [{ channelId: null, name: "Ops", kind, targets: kind === "email" ? [ADDRESS] : ["(typed on Confirm)"] }],
    },
    summary: `Create the ${kind} channel "Ops" (ops) in Org. Recipients: 1.`,
  });
}

/** `F4.279` (Q12): a webhook create's Confirm stays disabled until the typed URL parses. */
export async function aWebhookCreateWaitsForAUrl(): Promise<void> {
  vi.spyOn(confirmApi, "confirmCopilotChange").mockResolvedValue({ id: "c-1" });
  await proposed(channelCreate("webhook"));
  const card = await screen.findByRole("region", { name: "Create a notification channel" });
  const confirm = within(card).getByRole("button", { name: "Confirm" }) as HTMLButtonElement;
  const url = within(card).getByLabelText("Webhook URL") as HTMLInputElement;
  expect([confirm.disabled, url.type]).toEqual([true, "url"]);
  fireEvent.change(url, { target: { value: "not a url" } });
  expect(confirm.disabled).toBe(true);
  fireEvent.change(url, { target: { value: "https://hooks.example.test/x" } });
  expect(confirm.disabled).toBe(false);
}

/** `F4.279` (Q11, Q10): the webhook secret is an optional password box; the typed URL goes with Confirm. */
export async function aWebhookCreateSendsTheTypedUrlAndAnOptionalSecret(): Promise<void> {
  const sent = vi.spyOn(confirmApi, "confirmCopilotChange").mockResolvedValue({ id: "c-1" });
  vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue(EMPTY_CONVERSATION);
  await proposed(channelCreate("webhook"));
  const card = await screen.findByRole("region", { name: "Create a notification channel" });
  const secret = within(card).getByLabelText("Webhook secret (optional)") as HTMLInputElement;
  expect(secret.type).toBe("password");
  fireEvent.change(within(card).getByLabelText("Webhook URL"), { target: { value: "https://hooks.example.test/x" } });
  fireEvent.click(within(card).getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
  expect(sent.mock.calls[0]?.[1]).toEqual({ secret: "", "config.url": "https://hooks.example.test/x" });
}

/** `F4.279` (Q11): an email create shows no box, and its Confirm sends no secret. */
export async function anEmailCreateSendsNoSecret(): Promise<void> {
  const sent = vi.spyOn(confirmApi, "confirmCopilotChange").mockResolvedValue({ id: "c-1" });
  vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue(EMPTY_CONVERSATION);
  await proposed(channelCreate("email"));
  const card = await screen.findByRole("region", { name: "Create a notification channel" });
  expect(within(card).queryByLabelText(/Webhook/)).toBeNull();
  fireEvent.click(within(card).getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
  expect(sent.mock.calls[0]?.[1]).toEqual({});
}

/** `F4.279` (D5): the recipients list shows the address in full; the summary the model wrote does not. */
export async function theRecipientsAreShownInFull(): Promise<void> {
  const pending = channelCreate("email");
  await proposed(pending);
  const card = await screen.findByRole("region", { name: "Create a notification channel" });
  const list = within(card).getByTestId("copilot-recipients");
  expect([list.textContent, pending.summary.includes("@")]).toEqual([`Ops (email): ${ADDRESS}`, false]);
}

/** `F4.280`: a report schedule create card, as the server stores it (the recipients card-only, D5). */
function scheduleCreate(): CopilotPendingChangeDto {
  return change({
    catalogId: "reportSchedule.create",
    path: "/api/v1/reports/schedules",
    risk: "create",
    body: {
      organizationId: CHANNEL_ORG,
      name: "Weekly energy",
      formats: ["pdf"],
      cadence: "weekly",
      runAtLocal: "07:00",
      timezone: "Asia/Kolkata",
      locationIds: [],
      channelId: "77777777-7777-4777-8777-777777777777",
      recipients: [{ channelId: "77777777-7777-4777-8777-777777777777", name: "Ops", kind: "email", targets: [ADDRESS] }],
    },
    summary:
      'Create the weekly report schedule "Weekly energy" in Org: pdf at 07:00 Asia/Kolkata, the whole organization, emailed to a channel on every run with no later Confirm. Email delivery: channel "Ops", 1 recipient, on every run with no later Confirm.',
  });
}

/** `F4.280` (D5): a schedule card lists every recipient address in full. */
export async function aScheduleCardListsTheRecipientsInFull(): Promise<void> {
  await proposed(scheduleCreate());
  const card = await screen.findByRole("region", { name: "Create a report schedule" });
  expect(within(card).getByTestId("copilot-recipients").textContent).toBe(`Ops (email): ${ADDRESS}`);
}

/** `F4.280` (D5, adjacent negative): the schedule card's summary text names no address. */
export async function aScheduleCardSummaryNamesNoAddress(): Promise<void> {
  const pending = scheduleCreate();
  await proposed(pending);
  const card = await screen.findByRole("region", { name: "Create a report schedule" });
  // The address is on the card (the recipients list), and not in the summary's own element.
  expect([within(card).getByText(pending.summary).textContent?.includes("@"), card.textContent?.includes(ADDRESS)]).toEqual([false, true]);
}
