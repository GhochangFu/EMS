import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, vi } from "vitest";

import type {
  CopilotConversationDetailDto,
  CopilotPendingChangeDto,
  CopilotSkillStateDto,
  CopilotStatusDto,
  OnboardingSessionDto,
  UserRole,
} from "@bms/shared";
import { COPILOT_CHANGE_HEADER } from "@bms/shared/copilot";

import * as copilotApi from "../../api/copilot";
import { ONBOARDING_COMMIT_DRAFT_CHANGED, ONBOARDING_COMMIT_NOT_A_DRAFT } from "../onboarding/onboarding-commit-wizard";
import { useCopilotStore } from "../../stores/copilot-store";
import { CONVERSATION_ID, answered, openPanel, READY, renderDock, settle, stub } from "./copilot-dock.spec";

/**
 * `F3.86` PR 6 (ADR 0099 decision 7; plan §8.3) — the copilot dock while the
 * conversation runs the onboarding skill (`OnboardingSkillPanel`).
 *
 * Every copilot read is a module spy; the onboarding routes and the Confirm's
 * request go through a stubbed global `fetch`, so the URL, the body and the
 * headers each request carried are asserted. Assertions live here; the
 * sibling `.test.tsx` is the Vitest entry point (ADR 0014, ADR 0042).
 */

const ORG = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const CHANGE = "55555555-5555-4555-8555-555555555555";
const HASH = "c".repeat(64);
const SECRET = "Sup3r-s3cret-Pa55";
/** The route's sentence (`PROPOSED_DRAFT_CHANGED`, `onboarding-commit.service.ts`). */
const DRAFT_CHANGED =
  "The draft changed after the commit was proposed, so nothing was committed. Ask for the commit to be proposed again.";
const EMPTY_STATE = /Ask about alarms, assets, KPIs/;

function session(overrides: Partial<OnboardingSessionDto> = {}): OnboardingSessionDto {
  return {
    id: SESSION,
    organizationId: ORG,
    organizationCode: "ESKOM",
    organizationName: "Eskom",
    status: "draft",
    currentPhase: "rtu",
    draft: { rtus: [{ code: "RTU-1", displayName: "RTU 1", protocol: "simulator", config: {} }] } as never,
    messages: [{ id: "o1", role: "assistant", content: "Welcome to onboarding.", createdAt: "2026-10-12T00:00:00.000Z" }],
    createdAt: "2026-10-12T00:00:00.000Z",
    updatedAt: "2026-10-12T00:00:00.000Z",
    committedAt: null,
    result: null,
    checkpoints: [],
    draftHash: HASH,
    ...overrides,
  };
}

function skillState(overrides: Partial<CopilotSkillStateDto> = {}): CopilotSkillStateDto {
  return {
    kind: "onboarding",
    sessionId: SESSION,
    session: session(),
    suggestedReplies: ["Add an RTU", "undo", "View draft"],
    validationErrors: [],
    ...overrides,
  };
}

const COMMIT_CARD: CopilotPendingChangeDto = {
  id: CHANGE,
  catalogId: "onboarding.commit",
  method: "POST",
  path: `/api/v1/admin/onboarding/sessions/${SESSION}/commit`,
  body: { draftHash: HASH },
  summary: 'Commit the onboarding draft for site "Plant 4". It creates 1 RTU, 0 assets and 0 mappings.',
  risk: "create",
  proposedAt: "2026-10-12T00:00:00.000Z",
  expiresAt: "2026-10-12T00:15:00.000Z",
};

function detail(skill: CopilotSkillStateDto | null, pendingChanges: CopilotPendingChangeDto[] = []): CopilotConversationDetailDto {
  return {
    id: CONVERSATION_ID,
    organizationId: ORG,
    title: null,
    createdAt: "2026-10-12T00:00:00.000Z",
    lastTurnAt: "2026-10-12T00:00:00.000Z",
    messages: [],
    pendingChanges,
    skill,
  };
}

type Sent = { url: string; method: string; headers: Headers; body: string };

/** Stubs `fetch`; each request is recorded, and `answer` replies per URL. */
function stubFetch(answer: (url: string) => { status: number; json: unknown }): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      sent.push({ url, method: init.method ?? "GET", headers: new Headers(init.headers), body: String(init.body ?? "") });
      const { status, json } = answer(url);
      return new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
    }),
  );
  return sent;
}

/** An `OnboardingCommitResponseDto` (the route's 201 body). */
const COMMITTED = {
  sessionId: SESSION,
  locationId: "66666666-6666-4666-8666-666666666666",
  rtuIds: [],
  assetIds: [],
  pointKeyIds: [],
  assetPointIds: [],
  templateIds: [],
  templatedAssetCount: 0,
  templatedAssetPointCount: 0,
  seededRuleCount: 0,
  dashboardCount: 0,
};

/** A scoped administrator's dock, open, on a conversation that runs the skill. */
async function openSkill(
  options: { status?: CopilotStatusDto; skill?: CopilotSkillStateDto; cards?: CopilotPendingChangeDto[]; role?: UserRole } = {},
) {
  const stubs = stub(options.status ?? READY);
  const load = vi
    .spyOn(copilotApi, "fetchCopilotConversation")
    .mockResolvedValueOnce(detail(options.skill ?? skillState(), options.cards ?? []))
    .mockResolvedValue(detail(options.skill ?? skillState()));
  useCopilotStore.getState().setConversation("u1", CONVERSATION_ID);
  renderDock(options.role ?? "organization_admin");
  await openPanel();
  await screen.findByText("Welcome to onboarding.");
  return { ...stubs, load };
}

/** The chips are the server's `suggestedReplies` (minus "undo", which has its own control), and the generic empty state never shows. */
export async function aSkillConversationRendersTheChips(): Promise<void> {
  await openSkill();
  const chips = screen.getByRole("group", { name: "Suggested replies" });
  expect(within(chips).getAllByRole("button").map((b) => b.textContent)).toEqual(["Add an RTU", "View draft"]);
  expect(screen.queryByText(EMPTY_STATE)).not.toBeInTheDocument();
  // The skill hides the start action; the input is the dock's own.
  expect(screen.queryByRole("button", { name: "Onboard a site" })).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Message the copilot" })).toBeInTheDocument();
}

/** A chip sends its text as a turn. */
export async function aChipSendsItsTextAsATurn(): Promise<void> {
  const stubs = await openSkill();
  stubs.turn.mockResolvedValue({ ...answered("Add an RTU", "ok"), skill: skillState({ suggestedReplies: [] }) });
  fireEvent.click(screen.getByRole("button", { name: "Add an RTU" }));
  await waitFor(() => expect(stubs.turn).toHaveBeenCalledWith(CONVERSATION_ID, "Add an RTU"));
}

/** No AI key here (`configured: false`): a bound skill still takes input (the onboarding's guided mode answers). */
export async function aSkillTakesInputWithNoKey(): Promise<void> {
  await openSkill({ status: { available: true, configured: false } });
  expect(screen.getByRole("textbox", { name: "Message the copilot" })).toBeInTheDocument();
  expect(screen.queryByText(/no AI key is set up for this scope/)).not.toBeInTheDocument();
}

/**
 * ADR 0022: the credentials form posts to `…/credentials` with the typed
 * secret, and no turn ever carries it — the positive (a turn was sent, and
 * the credentials request holds the secret) beside the absence.
 */
export async function credentialsGoToTheirRouteAndNeverToATurn(): Promise<void> {
  const stubs = await openSkill();
  stubs.turn.mockResolvedValue({ ...answered("Add an RTU", "ok"), skill: skillState() });
  const sent = stubFetch(() => ({ status: 200, json: session() }));
  fireEvent.click(screen.getByRole("button", { name: "Add an RTU" }));
  await waitFor(() => expect(stubs.turn).toHaveBeenCalledTimes(1));

  fireEvent.click(screen.getByRole("button", { name: /^Preview/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Add credentials" }));
  fireEvent.change(screen.getByPlaceholderText("Username"), { target: { value: "ops" } });
  fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: SECRET } });
  fireEvent.click(screen.getByRole("button", { name: "Save encrypted" }));

  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0]!.url).toMatch(new RegExp(`/api/v1/admin/onboarding/sessions/${SESSION}/credentials$`));
  expect(sent[0]!.method).toBe("POST");
  expect(JSON.parse(sent[0]!.body)).toEqual({ rtuIndex: 0, credentials: { username: "ops", password: SECRET } });
  expect(stubs.turn).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(stubs.turn.mock.calls)).not.toContain(SECRET);
}

/** The agent's proposed commit is a Confirm card: Confirm posts `{ draftHash }` with the `X-Copilot-Change` header. */
export async function theCommitCardConfirmsWithTheHeader(): Promise<void> {
  await openSkill({ cards: [COMMIT_CARD] });
  const sent = stubFetch(() => ({ status: 201, json: COMMITTED }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0]!.url).toMatch(new RegExp(`/api/v1/admin/onboarding/sessions/${SESSION}/commit$`));
  expect(JSON.parse(sent[0]!.body)).toEqual({ draftHash: HASH });
  expect(sent[0]!.headers.get(COPILOT_CHANGE_HEADER)).toBe(CHANGE);
}

/** A draft changed after the proposal: the route's 400 sentence shows on the card. */
export async function aChangedDraftShowsTheRoutesSentence(): Promise<void> {
  await openSkill({ cards: [COMMIT_CARD] });
  stubFetch(() => ({ status: 400, json: { statusCode: 400, message: DRAFT_CHANGED, error: "Bad Request" } }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
  expect(await screen.findByText(DRAFT_CHANGED)).toBeInTheDocument();
}

/**
 * The drawer's Commit is the `onboarding.commit` wizard: Submit posts
 * `{ draftHash }` and carries no `X-Copilot-Change` header (a wizard is not a
 * copilot change) — the body holds the hash beside the header's absence.
 */
export async function theDrawerCommitIsTheWizardWithoutTheHeader(): Promise<void> {
  await openSkill();
  const sent = stubFetch(() => ({ status: 201, json: COMMITTED }));
  fireEvent.click(screen.getByRole("button", { name: /^Preview/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Commit" }));
  const wizard = await screen.findByRole("dialog");
  fireEvent.click(within(wizard).getByRole("button", { name: "Next" }));
  fireEvent.click(await within(wizard).findByRole("button", { name: "Submit" }));
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0]!.url).toMatch(new RegExp(`/api/v1/admin/onboarding/sessions/${SESSION}/commit$`));
  expect(JSON.parse(sent[0]!.body)).toEqual({ draftHash: HASH });
  expect(sent[0]!.headers.has(COPILOT_CHANGE_HEADER)).toBe(false);
  expect(await screen.findByText(/The site is committed/)).toBeInTheDocument();
}

/**
 * A turn that answers `skill: null` (the session is no longer readable) stores
 * nothing — the server's shape: no messages — and returns the dock to the
 * plain conversation; the sentence is the banner.
 */
export async function aLostSessionReturnsToThePlainConversation(): Promise<void> {
  const stubs = await openSkill();
  const lost = "This onboarding is no longer available to you here, so it has ended in this conversation.";
  stubs.turn.mockResolvedValue({ ...answered("next", lost), messages: [], pendingChanges: [], skill: null });
  fireEvent.click(screen.getByRole("button", { name: "Add an RTU" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(lost);
  await waitFor(() => expect(screen.queryByText("Welcome to onboarding.")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Onboard a site" })).toBeInTheDocument();
}

/** A new commit card replaces the old one (the server discarded it): one Confirm, the new card's. */
export async function aNewCommitCardReplacesTheOld(): Promise<void> {
  const stubs = await openSkill({ cards: [COMMIT_CARD] });
  const next: CopilotPendingChangeDto = {
    ...COMMIT_CARD,
    id: "77777777-7777-4777-8777-777777777777",
    body: { draftHash: "d".repeat(64) },
    summary: 'Commit the onboarding draft for site "Plant 5". It creates 2 RTUs, 0 assets and 0 mappings.',
  };
  await screen.findByText(COMMIT_CARD.summary);
  stubs.turn.mockResolvedValue({ ...answered("commit it", "Ready."), pendingChanges: [next], skill: skillState() });
  fireEvent.click(screen.getByRole("button", { name: "Add an RTU" }));
  expect(await screen.findByText(next.summary)).toBeInTheDocument();
  expect(screen.queryByText(COMMIT_CARD.summary)).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Confirm" })).toHaveLength(1);
}

/** Ruling Q4: an organization whose copilot is off offers no onboarding — the dock's off state covers it. */
export async function aSwitchedOffOrganizationOffersNoOnboarding(): Promise<void> {
  const stubs = stub(READY);
  stubs.status.mockImplementation(async (organizationId?: string) =>
    organizationId ? { available: false, configured: false } : READY,
  );
  renderDock("admin");
  await openPanel();
  // Positive: before the pick the action is there (waiting for an organization).
  expect(await screen.findByRole("button", { name: "Onboard a site" })).toBeInTheDocument();
  const select = screen.getByRole("combobox", { name: "Organization" });
  const option = await within(select).findByRole("option", { name: "PHE Water" });
  fireEvent.change(select, { target: { value: (option as HTMLOptionElement).value } });
  expect(await screen.findByText("The copilot is off for this organization.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Onboard a site" })).not.toBeInTheDocument();
}

/** A credential refusal answers with no `skill` key: the panel and its state stay. */
export async function aRefusalWithoutASkillKeyKeepsThePanel(): Promise<void> {
  const stubs = await openSkill();
  stubs.turn.mockResolvedValue({ ...answered("x", "That message looks like a credential."), messages: [], outcome: "credential_refused" });
  fireEvent.click(screen.getByRole("button", { name: "Add an RTU" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("That message looks like a credential.");
  expect(screen.getByText("Welcome to onboarding.")).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Suggested replies" })).toBeInTheDocument();
}

/** "Onboard a site" makes the conversation, then starts the skill in its organization. */
export async function onboardASiteStartsTheSkill(): Promise<void> {
  const stubs = stub(READY);
  stubs.create.mockResolvedValue({
    id: CONVERSATION_ID,
    organizationId: ORG,
    title: null,
    createdAt: "2026-10-12T00:00:00.000Z",
    lastTurnAt: "2026-10-12T00:00:00.000Z",
  });
  const start = vi.spyOn(copilotApi, "startCopilotOnboardingSkill").mockResolvedValue(detail(skillState()));
  renderDock("organization_admin");
  await openPanel();
  fireEvent.click(await screen.findByRole("button", { name: "Onboard a site" }));
  await waitFor(() => expect(start).toHaveBeenCalledWith(CONVERSATION_ID, ORG));
  expect(await screen.findByText("Welcome to onboarding.")).toBeInTheDocument();
}

/** A role that may not onboard (`location_admin`) is offered no start; the dock itself is open. */
export async function aLocationAdminIsNotOfferedOnboarding(): Promise<void> {
  stub(READY);
  renderDock("location_admin");
  await openPanel();
  await settle();
  expect(screen.getByRole("textbox", { name: "Message the copilot" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Onboard a site" })).not.toBeInTheDocument();
}

/** The global administrator on "All organizations" names no organization: the start waits for a pick. */
export async function theGlobalAdminPicksAnOrganizationFirst(): Promise<void> {
  stub(READY);
  renderDock("admin");
  await openPanel();
  expect(await screen.findByRole("button", { name: "Onboard a site" })).toBeDisabled();
  expect(screen.getByText("Pick an organization to onboard a site.")).toBeInTheDocument();
}

/** Opens the drawer's Commit wizard and Submits it; returns the dialog. */
async function submitTheWizard(): Promise<HTMLElement> {
  if (screen.queryByRole("button", { name: "Commit" }) === null) {
    fireEvent.click(screen.getByRole("button", { name: /^Preview/ }));
  }
  fireEvent.click(await screen.findByRole("button", { name: "Commit" }));
  const wizard = await screen.findByRole("dialog");
  fireEvent.click(within(wizard).getByRole("button", { name: "Next" }));
  fireEvent.click(await within(wizard).findByRole("button", { name: "Submit" }));
  return wizard;
}

/**
 * `F3.86` PR 6 review — a wizard Submit refused with 400 reads the session
 * again and hands it up, so the next Submit carries the new hash; the sentence
 * is the wizard's own (no proposal was made), never the route's.
 */
export async function aRefusedWizardSubmitRetriesWithTheNewHash(): Promise<void> {
  await openSkill();
  const fresh = "e".repeat(64);
  let commits = 0;
  const sent = stubFetch((url) => {
    if (url.endsWith("/commit")) {
      commits += 1;
      return commits === 1
        ? { status: 400, json: { statusCode: 400, message: DRAFT_CHANGED, error: "Bad Request" } }
        : { status: 201, json: COMMITTED };
    }
    return { status: 200, json: session({ draftHash: fresh }) };
  });
  const wizard = await submitTheWizard();
  expect(await within(wizard).findByText(ONBOARDING_COMMIT_DRAFT_CHANGED)).toBeInTheDocument();
  expect(screen.queryByText(DRAFT_CHANGED)).not.toBeInTheDocument();
  expect(sent.map((r) => [r.method, r.url.replace(/^.*\/api\/v1/, "")])).toEqual([
    ["POST", `/admin/onboarding/sessions/${SESSION}/commit`],
    ["GET", `/admin/onboarding/sessions/${SESSION}`],
  ]);
  fireEvent.click(within(wizard).getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(sent).toHaveLength(3));
  expect(JSON.parse(sent[0]!.body)).toEqual({ draftHash: HASH });
  expect(JSON.parse(sent[2]!.body)).toEqual({ draftHash: fresh });
  expect(await screen.findByText(/The site is committed/)).toBeInTheDocument();
}

/**
 * `F3.86` PR 6 review — the page committed the session while the drawer's wizard
 * was open: the 400's fresh read is a committed session, so the wizard says so
 * (its own sentence, not the draft-changed one), and the dock drops the open
 * commit card beside the committed message.
 */
export async function aSessionCommittedElsewhereSaysSoAndDropsTheCard(): Promise<void> {
  const stubs = await openSkill({ cards: [COMMIT_CARD] });
  stubs.load.mockResolvedValue(detail(skillState(), [COMMIT_CARD]));
  expect(await screen.findByText(COMMIT_CARD.summary)).toBeInTheDocument();
  let commits = 0;
  stubFetch((url) => {
    if (url.endsWith("/commit")) {
      commits += 1;
      return { status: 400, json: { statusCode: 400, message: DRAFT_CHANGED, error: "Bad Request" } };
    }
    return { status: 200, json: session({ status: "committed", draftHash: "e".repeat(64), committedAt: "2026-10-12T00:05:00.000Z" }) };
  });
  const wizard = await submitTheWizard();
  expect(await within(wizard).findByText(ONBOARDING_COMMIT_NOT_A_DRAFT)).toBeInTheDocument();
  expect(within(wizard).queryByText(ONBOARDING_COMMIT_DRAFT_CHANGED)).not.toBeInTheDocument();
  expect(screen.queryByText(DRAFT_CHANGED)).not.toBeInTheDocument();
  expect(commits).toBe(1);
  expect(await screen.findByText(/The site is committed/)).toBeInTheDocument();
  expect(screen.queryByText(COMMIT_CARD.summary)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
}

/** `F3.86` PR 6 review — a 400 whose fresh read fails shows the route's own sentence, and nothing is refreshed. */
export async function aFailedFreshReadShowsTheRoutesSentence(): Promise<void> {
  await openSkill();
  const sent = stubFetch((url) =>
    url.endsWith("/commit")
      ? { status: 400, json: { statusCode: 400, message: DRAFT_CHANGED, error: "Bad Request" } }
      : { status: 500, json: { statusCode: 500, message: "boom", error: "Internal Server Error" } },
  );
  const wizard = await submitTheWizard();
  expect(await within(wizard).findByText(DRAFT_CHANGED)).toBeInTheDocument();
  expect(within(wizard).queryByText(ONBOARDING_COMMIT_DRAFT_CHANGED)).not.toBeInTheDocument();
  expect(within(wizard).queryByText(ONBOARDING_COMMIT_NOT_A_DRAFT)).not.toBeInTheDocument();
  expect(sent.map((r) => r.method)).toEqual(["POST", "GET"]);
}

/** `F3.86` PR 6 review — a commit through the wizard drops the open commit card: its Confirm could only answer 400. */
export async function aWizardCommitDropsTheCommitCard(): Promise<void> {
  const stubs = await openSkill({ cards: [COMMIT_CARD] });
  // Every read still carries the card, so only the client's own drop can remove it.
  stubs.load.mockResolvedValue(detail(skillState(), [COMMIT_CARD]));
  expect(await screen.findByText(COMMIT_CARD.summary)).toBeInTheDocument();
  stubFetch(() => ({ status: 201, json: COMMITTED }));
  await submitTheWizard();
  expect(await screen.findByText(/The site is committed/)).toBeInTheDocument();
  expect(screen.queryByText(COMMIT_CARD.summary)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
}

/**
 * `F3.86` PR 6 review — "End onboarding" drops a commit card the dock still
 * keeps (a Confirm the route refused keeps its card): the plain conversation
 * shows no dead card. The end's answer is the server's, with no open change.
 */
export async function anEndDropsAKeptCommitCard(): Promise<void> {
  const stubs = await openSkill({ cards: [COMMIT_CARD] });
  stubFetch(() => ({ status: 400, json: { statusCode: 400, message: DRAFT_CHANGED, error: "Bad Request" } }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
  expect(await screen.findByText(DRAFT_CHANGED)).toBeInTheDocument();
  const end = vi.spyOn(copilotApi, "endCopilotOnboardingSkill").mockResolvedValue(detail(null, []));
  // A follow-up poll after the End reads the plain conversation, as the server answers it.
  stubs.load.mockResolvedValue(detail(null, []));
  fireEvent.click(screen.getByRole("button", { name: "End onboarding" }));
  await waitFor(() => expect(end).toHaveBeenCalledWith(CONVERSATION_ID));
  expect(await screen.findByRole("button", { name: "Onboard a site" })).toBeInTheDocument();
  expect(screen.queryByText(COMMIT_CARD.summary)).not.toBeInTheDocument();
}

/**
 * `F3.86` PR 6 review — the preview's hint is an answer's: the drawer opened
 * on it, and a wizard commit (a local update) closes it for good.
 */
export async function aWizardCommitDoesNotReopenThePreview(): Promise<void> {
  await openSkill({ skill: skillState({ autoOpenPreview: true, autoOpenReason: "ready_to_commit" }) });
  expect(await screen.findByRole("button", { name: "Preview ◀" })).toBeInTheDocument();
  stubFetch(() => ({ status: 201, json: COMMITTED }));
  await submitTheWizard();
  expect(await screen.findByText(/The site is committed/)).toBeInTheDocument();
  await settle();
  expect(screen.getByRole("button", { name: "Preview ▶" })).toBeInTheDocument();
}

const CHECKPOINTED = skillState({
  session: session({ checkpoints: [{ id: "cp1", seq: 1, label: "Added RTU-1", takenAt: "2026-10-12T00:00:00.000Z" }] }),
});

/** The undo's request waits until `release` is called; nothing else is answered. */
function deferUndo(): { release: () => void } {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      await held;
      const body = { assistantMessage: "Undone.", session: CHECKPOINTED.session };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  return { release: () => release() };
}

/** `F3.86` PR 6 review (F3.25, one write at a time) — the dock's Send is disabled while the panel's undo is in flight. */
export async function sendIsDisabledWhileAnUndoIsInFlight(): Promise<void> {
  await openSkill({ skill: CHECKPOINTED });
  const undo = deferUndo();
  fireEvent.change(screen.getByRole("textbox", { name: "Message the copilot" }), { target: { value: "Add an asset" } });
  expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await screen.findByRole("button", { name: "Undoing…" });
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  undo.release();
  await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
}

/** `F3.86` PR 6 review — Enter sends no turn while the panel's undo is in flight, and does once it is done. */
export async function enterSendsNothingWhileAnUndoIsInFlight(): Promise<void> {
  const stubs = await openSkill({ skill: CHECKPOINTED });
  stubs.turn.mockResolvedValue({ ...answered("Add an asset", "ok"), skill: CHECKPOINTED });
  const undo = deferUndo();
  const box = screen.getByRole("textbox", { name: "Message the copilot" });
  fireEvent.change(box, { target: { value: "Add an asset" } });
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await screen.findByRole("button", { name: "Undoing…" });
  fireEvent.keyDown(box, { key: "Enter" });
  await settle();
  expect(stubs.turn).not.toHaveBeenCalled();
  undo.release();
  await screen.findByRole("button", { name: "Undo" });
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => expect(stubs.turn).toHaveBeenCalledWith(CONVERSATION_ID, "Add an asset"));
}
