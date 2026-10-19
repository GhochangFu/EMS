import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { CopilotConversationDetailDto, CopilotSkillStateDto, OnboardingDraftListDto, UserRole } from "@bms/shared";

import * as copilotApi from "../../api/copilot";
import { ApiError } from "../../lib/api-error";
import { onboardingDraftsKey } from "../../lib/copilot-invalidations";
import type { AuthUser } from "../../stores/auth-store";
import { copilotConversationKey, useCopilotStore } from "../../stores/copilot-store";
import { COPILOT_OPEN_KEY, CopilotDock } from "./copilot-dock";
import { answered, CONVERSATION_ID, READY, send, stub } from "./copilot-dock.spec";

/**
 * `F3.86` PR 7 (ruling Q5) — "Onboard with AI" asks the dock to start the
 * onboarding skill. The request is one-shot (`useCopilotStore`); the dock
 * consumes it, opens, picks the organization and calls the same
 * `startCopilotOnboardingSkill` as "Onboard a site".
 *
 * Assertions live here; `copilot-dock-onboard-request.test.tsx` is the Vitest
 * entry point (ADR 0014, ADR 0042). Every API read is a spy (`F4.160`).
 */

const ORG = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";

function asUser(role: UserRole): AuthUser {
  return { id: "u1", email: `${role}@bms.local`, displayName: role, role } as unknown as AuthUser;
}

function skillState(): CopilotSkillStateDto {
  return {
    kind: "onboarding",
    sessionId: SESSION,
    session: {
      id: SESSION,
      organizationId: ORG,
      organizationCode: "PHE",
      organizationName: "PHE Water",
      status: "draft",
      currentPhase: "location",
      draft: {},
      messages: [{ id: "o1", role: "assistant", content: "Welcome to onboarding.", createdAt: "2026-10-13T00:00:00.000Z" }],
      createdAt: "2026-10-13T00:00:00.000Z",
      updatedAt: "2026-10-13T00:00:00.000Z",
      committedAt: null,
      result: null,
      checkpoints: [],
      draftHash: "a".repeat(64),
      discovery: null,
    },
    suggestedReplies: [],
    validationErrors: [],
  } as unknown as CopilotSkillStateDto;
}

function detail(skill: CopilotSkillStateDto | null): CopilotConversationDetailDto {
  return {
    id: CONVERSATION_ID,
    organizationId: ORG,
    title: null,
    createdAt: "2026-10-13T00:00:00.000Z",
    lastTurnAt: "2026-10-13T00:00:00.000Z",
    messages: [],
    pendingChanges: [],
    skill,
  };
}

/** The stubs every case needs; the conversation the dock makes is in `ORG`. */
function stubs() {
  const base = stub(READY);
  base.create.mockResolvedValue({
    id: CONVERSATION_ID,
    organizationId: ORG,
    title: null,
    createdAt: "2026-10-13T00:00:00.000Z",
    lastTurnAt: "2026-10-13T00:00:00.000Z",
  });
  const start = vi.spyOn(copilotApi, "startCopilotOnboardingSkill").mockResolvedValue(detail(skillState()));
  return { ...base, start };
}

function tree(role: UserRole, client: QueryClient) {
  return (
    <StrictMode>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CopilotDock user={asUser(role)} />
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>
  );
}

/** Renders the dock under StrictMode, which runs every mount effect twice. */
function renderStrict(role: UserRole) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(tree(role, client));
  return { rerender: () => view.rerender(tree(role, client)) };
}

async function fileRequest(): Promise<void> {
  await act(async () => {
    useCopilotStore.getState().requestOnboarding("u1", ORG);
  });
}

const settleABit = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

/**
 * (a) One request leads to exactly one start call, also after a re-render and under StrictMode.
 * Filed before the dock mounts, StrictMode runs the consuming effect twice on the same request.
 */
export async function oneRequestStartsTheSkillExactlyOnce(): Promise<void> {
  const { start, create } = stubs();
  useCopilotStore.getState().requestOnboarding("u1", ORG);
  const view = renderStrict("organization_admin");

  await waitFor(() => expect(start).toHaveBeenCalledWith(CONVERSATION_ID, ORG));
  expect(useCopilotStore.getState().onboardRequest).toBeNull();
  expect(screen.getByRole("complementary", { name: "Copilot" })).toBeInTheDocument();
  view.rerender();
  await settleABit();
  expect(start).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledTimes(1);
}

/** (a) The same, for a request filed while the dock is already mounted (the organizations page's case). */
export async function aRequestFiledAfterTheMountStartsTheSkillOnce(): Promise<void> {
  const { start, create } = stubs();
  const view = renderStrict("organization_admin");
  await screen.findByRole("button", { name: "Open the copilot" });
  expect(start).not.toHaveBeenCalled();

  await fileRequest();

  await waitFor(() => expect(start).toHaveBeenCalledWith(CONVERSATION_ID, ORG));
  expect(useCopilotStore.getState().onboardRequest).toBeNull();
  view.rerender();
  await settleABit();
  expect(start).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledTimes(1);
}

/** (b) With a skill already bound to the conversation, a request starts no second one. */
export async function aRequestDoesNotStartASecondSkill(): Promise<void> {
  const { start } = stubs();
  const load = vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue(detail(skillState()));
  useCopilotStore.getState().setConversation("u1", CONVERSATION_ID);
  renderStrict("organization_admin");
  await screen.findByRole("button", { name: "Open the copilot" });

  await fileRequest();

  // Positive: the panel opened and the bound skill's thread loaded; the start still did not run.
  expect(await screen.findByText("Welcome to onboarding.")).toBeInTheDocument();
  await settleABit();
  expect(load).toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
  expect(useCopilotStore.getState().onboardRequest).toBeNull();
}

/** (c) With the organization's switch off, nothing starts and the dock's off sentence shows. */
export async function aSwitchedOffOrganizationStartsNothing(): Promise<void> {
  const { start, create, status } = stubs();
  status.mockImplementation(async (organizationId?: string) =>
    organizationId ? { available: false, configured: false } : READY,
  );
  renderStrict("admin");
  await screen.findByRole("button", { name: "Open the copilot" });

  await fileRequest();

  expect(await screen.findByText("The copilot is off for this organization.")).toBeInTheDocument();
  await settleABit();
  expect(status).toHaveBeenCalledWith(ORG);
  expect(start).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
}

/** (d) The global administrator's request picks that organization, then starts the skill in it. */
export async function theGlobalAdminsRequestPicksThatOrganization(): Promise<void> {
  const { start, create } = stubs();
  renderStrict("admin");
  await screen.findByRole("button", { name: "Open the copilot" });
  expect(useCopilotStore.getState().organizationId).toBe("");

  await fileRequest();

  await waitFor(() => expect(start).toHaveBeenCalledWith(CONVERSATION_ID, ORG));
  expect(create).toHaveBeenCalledWith(ORG);
  expect(useCopilotStore.getState().organizationId).toBe(ORG);
  expect(start).toHaveBeenCalledTimes(1);
}

/** A request the dock never saw expires, and another user's is dropped (the store's own rules). */
export function anExpiredOrForeignRequestIsDropped(): void {
  vi.useFakeTimers();
  try {
    useCopilotStore.getState().requestOnboarding("u1", ORG);
    expect(useCopilotStore.getState().consumeOnboardRequest("u2")).toBeNull();
    expect(useCopilotStore.getState().onboardRequest).toBeNull();

    useCopilotStore.getState().requestOnboarding("u1", ORG);
    vi.advanceTimersByTime(30_001);
    expect(useCopilotStore.getState().consumeOnboardRequest("u1")).toBeNull();

    useCopilotStore.getState().requestOnboarding("u1", ORG);
    expect(useCopilotStore.getState().consumeOnboardRequest("u1")).toMatchObject({ organizationId: ORG });
    expect(useCopilotStore.getState().consumeOnboardRequest("u1")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
}

// ---------------------------------------------------------------------------
// `F4.255` PR 3 (plan §6.3, ADR 0099 Amendment 2 A1) — the dock lists the
// organization's open drafts beside the start; Resume is a skill start with the
// draft's id.
// ---------------------------------------------------------------------------

const DRAFT = "66666666-6666-4666-8666-666666666666";

const ONE_DRAFT: OnboardingDraftListDto = {
  items: [
    {
      id: DRAFT,
      organizationId: ORG,
      currentPhase: "rtu",
      locationName: "Lotapata",
      createdAt: "2026-10-13T00:00:00.000Z",
      updatedAt: "2026-10-13T00:00:00.000Z",
      createdBy: { id: "u1", displayName: "organization_admin" },
    },
  ],
};

/** A dock with a fresh client the case can seed; the panel opens from the remembered state. */
function renderOpen(role: UserRole, seed?: (client: QueryClient) => void): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed?.(client);
  window.localStorage.setItem(COPILOT_OPEN_KEY, "true");
  render(tree(role, client));
  return client;
}

/** D1 — Resume on a listed draft starts the skill with that draft's id, and the dock shows the resumed session. */
export async function resumeStartsTheSkillWithTheDraftsId(): Promise<void> {
  const { start, drafts } = stubs();
  drafts.mockResolvedValue(ONE_DRAFT);
  renderOpen("organization_admin");
  const list = await screen.findByRole("list", { name: "Onboarding drafts" });
  // No conversation yet: the home list, which names no organization.
  expect(drafts.mock.calls[0]).toEqual([undefined]);

  fireEvent.click(within(list).getByRole("button", { name: "Resume" }));

  await waitFor(() => expect(start).toHaveBeenCalledWith(CONVERSATION_ID, ORG, DRAFT));
  expect(start).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("Welcome to onboarding.")).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Onboarding drafts" })).not.toBeInTheDocument();
}

/** D2 — "Start new" beside a listed draft starts a new session: two arguments, no session id. */
export async function startNewSendsNoSessionId(): Promise<void> {
  const { start, drafts } = stubs();
  drafts.mockResolvedValue(ONE_DRAFT);
  renderOpen("organization_admin");
  fireEvent.click(await screen.findByRole("button", { name: "Start new" }));

  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  expect(start).toHaveBeenCalledWith(CONVERSATION_ID, ORG);
  expect(start.mock.calls[0]).toHaveLength(2);
}

/**
 * D3 — End onboarding makes the list stale: the ended draft is listed again. The list is seeded
 * fresh in the cache before the mount, so only End's invalidation can make the remounted list read.
 */
export async function endReadsTheDraftListAgain(): Promise<void> {
  const { drafts } = stubs();
  const end = vi.spyOn(copilotApi, "endCopilotOnboardingSkill").mockResolvedValue(detail(null));
  useCopilotStore.getState().setConversation("u1", CONVERSATION_ID);
  renderOpen("organization_admin", (client) => {
    client.setQueryData(copilotConversationKey(CONVERSATION_ID), detail(skillState()));
    client.setQueryData(onboardingDraftsKey(ORG), { items: [] });
  });
  fireEvent.click(await screen.findByRole("button", { name: "End onboarding" }));

  await waitFor(() => expect(end).toHaveBeenCalledWith(CONVERSATION_ID));
  expect(await screen.findByRole("button", { name: "Onboard a site" })).toBeInTheDocument();
  await waitFor(() => expect(drafts).toHaveBeenCalledTimes(1));
  expect(drafts).toHaveBeenCalledWith(ORG);
}

/** A 409 for a draft that is no longer one. */
const closed409 = () =>
  new ApiError(JSON.stringify({ statusCode: 409, message: "That onboarding is no longer a draft.", error: "Conflict" }), 409);

/** D4 — a resume of a draft that is no longer a draft (409) shows the server's sentence as the start error. */
export async function aRefusedResumeShowsTheStartError(): Promise<void> {
  const { start, drafts } = stubs();
  drafts.mockResolvedValue(ONE_DRAFT);
  start.mockRejectedValue(closed409());
  renderOpen("organization_admin");
  const list = await screen.findByRole("list", { name: "Onboarding drafts" });
  fireEvent.click(within(list).getByRole("button", { name: "Resume" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("That onboarding is no longer a draft.");
  expect(start).toHaveBeenCalledWith(CONVERSATION_ID, ORG, DRAFT);
}

/**
 * D4b — a refused resume reads the list again, so the dead row goes. The conversation exists before
 * the click, so the list's key does not move: only the refusal's invalidation can make it read.
 */
export async function aRefusedResumeReadsTheDraftListAgain(): Promise<void> {
  const { start, drafts } = stubs();
  drafts.mockResolvedValue(ONE_DRAFT);
  start.mockRejectedValue(closed409());
  useCopilotStore.getState().setConversation("u1", CONVERSATION_ID);
  renderOpen("organization_admin", (client) => {
    client.setQueryData(copilotConversationKey(CONVERSATION_ID), detail(null));
  });
  const list = await screen.findByRole("list", { name: "Onboarding drafts" });
  expect(drafts).toHaveBeenCalledTimes(1);
  fireEvent.click(within(list).getByRole("button", { name: "Resume" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("That onboarding is no longer a draft.");
  await waitFor(() => expect(drafts).toHaveBeenCalledTimes(2));
  expect(drafts).toHaveBeenLastCalledWith(ORG);
}

/** D4 — the same for an unreadable draft (the uniform 404). */
export async function aNotFoundResumeShowsTheStartError(): Promise<void> {
  const { start, drafts } = stubs();
  drafts.mockResolvedValue(ONE_DRAFT);
  start.mockRejectedValue(
    new ApiError(JSON.stringify({ statusCode: 404, message: "Onboarding session not found", error: "Not Found" }), 404),
  );
  renderOpen("organization_admin");
  const list = await screen.findByRole("list", { name: "Onboarding drafts" });
  fireEvent.click(within(list).getByRole("button", { name: "Resume" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Onboarding session not found");
}

/**
 * D5 — a start makes the list stale: the list is seeded fresh, and after the start (no turn, no
 * End) its cache entry is invalidated. Only the start's invalidation can do that here.
 */
export async function aStartMakesTheDraftListStale(): Promise<void> {
  const { start, drafts } = stubs();
  useCopilotStore.getState().setConversation("u1", CONVERSATION_ID);
  const client = renderOpen("organization_admin", (c) => {
    c.setQueryData(copilotConversationKey(CONVERSATION_ID), detail(null));
    c.setQueryData(onboardingDraftsKey(ORG), { items: [] });
  });
  expect(client.getQueryState(onboardingDraftsKey(ORG))?.isInvalidated).toBe(false);
  fireEvent.click(await screen.findByRole("button", { name: "Onboard a site" }));
  await waitFor(() => expect(start).toHaveBeenCalledWith(CONVERSATION_ID, ORG));
  expect(await screen.findByText("Welcome to onboarding.")).toBeInTheDocument();

  // The invalidation either refetches the list (still mounted when it lands) or leaves it marked
  // stale (already unmounted); with neither, the seeded fresh entry would be served on the remount.
  await waitFor(() =>
    expect(client.getQueryState(onboardingDraftsKey(ORG))?.isInvalidated === true || drafts.mock.calls.length > 0).toBe(true),
  );
}

/**
 * D7 — a turn that ends the skill (`skill: null`: closed, lost or done) reads the list again. The
 * skill is bound before the mount and the list seeded fresh, so no start runs: only the turn's
 * invalidation can make the remounted list read.
 */
export async function aTurnThatEndsTheSkillReadsTheDraftListAgain(): Promise<void> {
  const { start, drafts, turn } = stubs();
  turn.mockResolvedValue({ ...answered("next", "It ended."), skill: null });
  useCopilotStore.getState().setConversation("u1", CONVERSATION_ID);
  renderOpen("organization_admin", (client) => {
    client.setQueryData(copilotConversationKey(CONVERSATION_ID), detail(skillState()));
    client.setQueryData(onboardingDraftsKey(ORG), { items: [] });
  });
  expect(await screen.findByText("Welcome to onboarding.")).toBeInTheDocument();

  await send("next");

  expect(await screen.findByRole("button", { name: "Onboard a site" })).toBeInTheDocument();
  await waitFor(() => expect(drafts).toHaveBeenCalledTimes(1));
  expect(drafts).toHaveBeenCalledWith(ORG);
  expect(start).not.toHaveBeenCalled();
}

/**
 * D8 — a turn that answers the session is no longer a draft (the closed reply: the skill state stays,
 * its status is not `draft`) makes the list stale. The panel still shows the skill, so the list is
 * not mounted: the seeded fresh entry is marked invalidated.
 */
export async function aClosedSessionTurnMakesTheDraftListStale(): Promise<void> {
  const { turn } = stubs();
  const closed = skillState();
  turn.mockResolvedValue({
    ...answered("next", "This onboarding is no longer a draft."),
    skill: { ...closed, session: { ...closed.session, status: "committed" } } as CopilotSkillStateDto,
  });
  useCopilotStore.getState().setConversation("u1", CONVERSATION_ID);
  const client = renderOpen("organization_admin", (c) => {
    c.setQueryData(copilotConversationKey(CONVERSATION_ID), detail(skillState()));
    c.setQueryData(onboardingDraftsKey(ORG), { items: [] });
  });
  expect(await screen.findByText("Welcome to onboarding.")).toBeInTheDocument();
  expect(client.getQueryState(onboardingDraftsKey(ORG))?.isInvalidated).toBe(false);

  await send("next");

  await waitFor(() => expect(client.getQueryState(onboardingDraftsKey(ORG))?.isInvalidated).toBe(true));
}

/** D9 — a plain turn (no `skill` key) leaves the list alone: no read and no invalidation. */
export async function aPlainTurnLeavesTheDraftListAlone(): Promise<void> {
  const { drafts, turn } = stubs();
  turn.mockResolvedValue(answered("hello", "Hi."));
  useCopilotStore.getState().setConversation("u1", CONVERSATION_ID);
  const client = renderOpen("organization_admin", (c) => {
    c.setQueryData(copilotConversationKey(CONVERSATION_ID), detail(null));
    c.setQueryData(onboardingDraftsKey(ORG), { items: [] });
  });
  expect(await screen.findByRole("button", { name: "Onboard a site" })).toBeInTheDocument();

  await send("hello");

  // The positive first: the turn landed in the thread.
  expect(await screen.findByText("Hi.")).toBeInTheDocument();
  await settleABit();
  expect(client.getQueryState(onboardingDraftsKey(ORG))?.isInvalidated).toBe(false);
  expect(drafts).not.toHaveBeenCalled();
}

/** G1 — a global administrator who picked an organization lists that organization's drafts. */
export async function aGlobalAdminListsThePickedOrganization(): Promise<void> {
  const { drafts } = stubs();
  useCopilotStore.getState().pick("u1", ORG);
  renderOpen("admin");
  await waitFor(() => expect(drafts).toHaveBeenCalled());
  expect(drafts.mock.calls).toEqual([[ORG]]);
}

/**
 * G2 — on "All organizations" the global administrator's list reads nothing and Start is disabled.
 * The positive first: the organization options have rendered and Start is present.
 */
export async function aGlobalAdminOnAllOrganizationsReadsNoList(): Promise<void> {
  const { drafts } = stubs();
  renderOpen("admin");
  expect(await screen.findByRole("option", { name: "PHE Water" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Onboard a site" })).toBeDisabled();
  await settleABit();
  expect(drafts).not.toHaveBeenCalled();
}

/** S1 — a scoped administrator with no conversation lists its home organization: the call names none. */
export async function aScopedAdminWithNoConversationListsItsHome(): Promise<void> {
  const { drafts, organizations } = stubs();
  renderOpen("organization_admin");
  await waitFor(() => expect(drafts).toHaveBeenCalledTimes(1));
  expect(drafts.mock.calls[0]).toEqual([undefined]);
  // The organizations list is the global administrator's picker: a scoped administrator never reads it.
  expect(organizations).not.toHaveBeenCalled();
}

/** D6 — while a resume is in flight, its row reads "Resuming…" and the start button keeps its label. */
export async function aPendingResumeDoesNotRelabelTheStart(): Promise<void> {
  const { start, drafts } = stubs();
  drafts.mockResolvedValue(ONE_DRAFT);
  start.mockReturnValue(new Promise(() => {}));
  renderOpen("organization_admin");
  const list = await screen.findByRole("list", { name: "Onboarding drafts" });
  fireEvent.click(within(list).getByRole("button", { name: "Resume" }));

  expect(await within(list).findByRole("button", { name: "Resuming…" })).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("button", { name: "Start new" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Starting…" })).not.toBeInTheDocument();
}
