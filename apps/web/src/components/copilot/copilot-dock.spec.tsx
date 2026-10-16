import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { expect, vi } from "vitest";

import type {
  CopilotMessageDto,
  CopilotPendingChangeDto,
  CopilotSkillStateDto,
  CopilotStatusDto,
  CopilotTurnResponseDto,
  UserRole,
} from "@bms/shared";
import { MAX_COPILOT_ATTACHMENT_BYTES, MAX_MIMIC_SYMBOL_SVG_BYTES } from "@bms/shared/contracts";

import * as onboardingApi from "../../api/admin/onboarding";
import * as organizationsApi from "../../api/admin/organizations";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import { AppShell } from "../../layouts/app-shell";
import { ApiError } from "../../lib/api-error";
import { useAuthStore, type AuthUser } from "../../stores/auth-store";
import { useCopilotStore } from "../../stores/copilot-store";
import { OPERATIONAL } from "../system-status-indicator.spec";
import { COPILOT_OPEN_KEY, CopilotDock, formatCopilotReset } from "./copilot-dock";

/**
 * `F3.85` PR 7 (ADR 0099 decisions 1, 5, 10; plan §9.2) — the copilot dock.
 *
 * Assertions live here; `copilot-dock.test.tsx` is the Vitest entry point and
 * carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042).
 *
 * Every API read the dock makes is a spy: an unstubbed fetch reaches a local
 * API on `:4000` (`F4.160`).
 */

export const CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

export const COPILOT_OFF: CopilotStatusDto = { available: false, configured: false };
export const READY: CopilotStatusDto = { available: true, configured: true };

function asUser(role: UserRole): AuthUser {
  return { id: "u1", email: `${role}@bms.local`, displayName: role, role } as unknown as AuthUser;
}

export function message(role: CopilotMessageDto["role"], content: string, n: number): CopilotMessageDto {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    conversationId: CONVERSATION_ID,
    role,
    content,
    organizationIds: [],
    createdAt: `2026-10-11T10:00:0${n}.000Z`,
  };
}

export function answered(
  question: string,
  reply: string,
  navigateTo: string | null = null,
  pendingChanges: CopilotPendingChangeDto[] = [],
): CopilotTurnResponseDto {
  return {
    conversationId: CONVERSATION_ID,
    outcome: "answered",
    configured: true,
    reply,
    messages: [message("user", question, 1), message("assistant", reply, 2)],
    navigateTo,
    pendingChanges,
    fillStep: null,
  };
}

/** Shows the router's pathname, so a navigation is asserted on the router, not on `window.location`. */
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="router-path">{location.pathname}</output>;
}

type Stubs = {
  status: ReturnType<typeof vi.spyOn>;
  create: ReturnType<typeof vi.spyOn>;
  turn: ReturnType<typeof vi.spyOn>;
  organizations: ReturnType<typeof vi.spyOn>;
  /** `F4.255` PR 3: the dock's draft list, empty unless a case says otherwise. */
  drafts: ReturnType<typeof vi.spyOn>;
};

export function stub(status: CopilotStatusDto = READY): Stubs {
  return {
    status: vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue(status),
    create: vi.spyOn(copilotApi, "createCopilotConversation").mockResolvedValue({
      id: CONVERSATION_ID,
      organizationId: null,
      title: null,
      createdAt: "2026-10-11T10:00:00.000Z",
      lastTurnAt: "2026-10-11T10:00:00.000Z",
    }),
    turn: vi.spyOn(copilotApi, "sendCopilotTurn").mockResolvedValue(answered("q", "a")),
    organizations: vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({
      items: [
        {
          id: ORG_ID,
          code: "PHE",
          name: "PHE Water",
          active: true,
          currency: "INR",
          timezone: "Asia/Kolkata",
          meta: null,
        },
      ],
    } as never),
    drafts: vi.spyOn(onboardingApi, "fetchOnboardingDrafts").mockResolvedValue({ items: [] }),
  };
}

export function renderDock(role: UserRole, path = "/"): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <CopilotDock user={asUser(role)} />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const OPEN_BUTTON = { name: "Open the copilot" } as const;

export async function openPanel(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", OPEN_BUTTON));
  await screen.findByRole("complementary", { name: "Copilot" });
}

export async function send(text: string): Promise<void> {
  const box = await screen.findByRole("textbox", { name: "Message the copilot" });
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
}

/** Lets every settled query render; an absence check runs only after this. */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export async function showsTheButtonToAnAdminWhenAvailable(): Promise<void> {
  stub(READY);
  renderDock("admin");
  expect(await screen.findByRole("button", OPEN_BUTTON)).toBeInTheDocument();
}

/** §5: the button shows the mockup's bot mark (decorative), not a text label. */
export async function showsTheMockupsBotMarkOnTheButton(): Promise<void> {
  stub(READY);
  renderDock("admin");
  const button = await screen.findByRole("button", OPEN_BUTTON);
  expect(button.querySelector('svg[aria-hidden="true"] rect')).not.toBeNull();
  expect(button).not.toHaveTextContent("AI");
}

export async function showsNoButtonToAnOperator(): Promise<void> {
  const stubs = stub(READY);
  renderDock("operator");
  await settle();
  // Positive: the tree rendered; the dock alone is absent.
  expect(screen.getByTestId("router-path")).toHaveTextContent("/");
  expect(screen.queryByRole("button", OPEN_BUTTON)).not.toBeInTheDocument();
  // An operator gets a 403 from the status route, so the dock never asks.
  expect(stubs.status).not.toHaveBeenCalled();
}

export async function showsNoButtonWhenTheStatusIsUnavailable(): Promise<void> {
  const stubs = stub(COPILOT_OFF);
  renderDock("admin");
  await waitFor(() => expect(stubs.status).toHaveBeenCalledTimes(1));
  await settle();
  expect(screen.getByTestId("router-path")).toHaveTextContent("/");
  expect(screen.queryByRole("button", OPEN_BUTTON)).not.toBeInTheDocument();
}

export async function showsTheButtonOnAnotherOrganizationPage(): Promise<void> {
  stub(READY);
  renderDock("admin", `/admin/organizations/${ORG_ID}/ai-assistant`);
  expect(await screen.findByRole("button", OPEN_BUTTON)).toBeInTheDocument();
}

export async function sendsTheTypedTextAndRendersTheReply(): Promise<void> {
  const stubs = stub(READY);
  stubs.turn.mockResolvedValue(answered("How many alarms?", "There are **3** active alarms."));
  renderDock("organization_admin");
  await openPanel();
  await send("How many alarms?");
  await waitFor(() => expect(stubs.turn).toHaveBeenCalledWith(CONVERSATION_ID, "How many alarms?"));
  const thread = screen.getByRole("log", { name: "Copilot conversation" });
  expect(await within(thread).findByText("3")).toBeInTheDocument();
  expect(within(thread).getByText("3").tagName).toBe("STRONG");
  expect(within(thread).getByText("How many alarms?")).toBeInTheDocument();
  // A scoped administrator's conversation is bound on the server, so the dock sends null.
  expect(stubs.create).toHaveBeenCalledWith(null);
}

export async function rendersTheResetTimeOnA429(): Promise<void> {
  const stubs = stub(READY);
  const resetsAt = "2026-10-12T18:30:00.000Z";
  stubs.turn.mockRejectedValue(
    new ApiError(
      JSON.stringify({
        statusCode: 429,
        message: "You have reached your daily copilot limit.",
        scope: "user",
        resetsAt,
      }),
      429,
    ),
  );
  renderDock("admin");
  await openPanel();
  await send("hello");
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(new Date(resetsAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
  expect(alert).toHaveTextContent("You have reached your daily copilot limit.");
  expect(alert).not.toHaveTextContent("statusCode");
}

export function formatsTheResetInTheUsersLocale(): void {
  const resetsAt = "2026-10-12T18:30:00.000Z";
  expect(formatCopilotReset(resetsAt)).toBe(
    new Date(resetsAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
  );
}

export async function navigatesThroughTheRouterOnOpenPage(): Promise<void> {
  const stubs = stub(READY);
  stubs.turn.mockResolvedValue(answered("Show me the alarms", "Opening the Alarm Centre.", "/alarms"));
  renderDock("admin");
  await openPanel();
  expect(screen.getByTestId("router-path")).toHaveTextContent(/^\/$/);
  await send("Show me the alarms");
  await waitFor(() => expect(screen.getByTestId("router-path")).toHaveTextContent(/^\/alarms$/));
}

export async function ignoresANavigateToThatIsNotAnAppRoute(): Promise<void> {
  const stubs = stub(READY);
  stubs.turn.mockResolvedValue(answered("go", "Done.", "//evil.example"));
  renderDock("admin");
  await openPanel();
  await send("go");
  const thread = screen.getByRole("log", { name: "Copilot conversation" });
  expect(await within(thread).findByText("Done.")).toBeInTheDocument();
  expect(screen.getByTestId("router-path")).toHaveTextContent(/^\/$/);
}

export async function showsTheSentenceAndNoInputWhenNotConfigured(): Promise<void> {
  stub({ available: true, configured: false });
  renderDock("admin");
  await openPanel();
  expect(await screen.findByText(/no AI key is set up/i)).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Message the copilot" })).not.toBeInTheDocument();
}

export async function showsTheInputWhenConfigured(): Promise<void> {
  stub(READY);
  renderDock("admin");
  await openPanel();
  expect(await screen.findByRole("textbox", { name: "Message the copilot" })).toBeInTheDocument();
  expect(screen.queryByText(/no AI key is set up/i)).not.toBeInTheDocument();
}

export async function bannersACredentialRefusalAndDoesNotRestoreTheInput(): Promise<void> {
  const stubs = stub(READY);
  const refusal = "That message looks like it contains a credential, so I have not sent it.";
  stubs.turn.mockResolvedValue({
    conversationId: CONVERSATION_ID,
    outcome: "credential_refused",
    configured: true,
    reply: refusal,
    messages: [],
    navigateTo: null,
  });
  renderDock("admin");
  await openPanel();
  await send("mqtt://user:secret@host");
  expect(await screen.findByRole("alert")).toHaveTextContent(refusal);
  expect(screen.getByRole("textbox", { name: "Message the copilot" })).toHaveValue("");
  const thread = screen.getByRole("log", { name: "Copilot conversation" });
  expect(within(thread).queryByText("mqtt://user:secret@host")).not.toBeInTheDocument();
}

export async function remembersTheOpenState(): Promise<void> {
  stub(READY);
  window.localStorage.removeItem(COPILOT_OPEN_KEY);
  renderDock("admin");
  await openPanel();
  expect(window.localStorage.getItem(COPILOT_OPEN_KEY)).toBe("true");
}

export async function opensFromTheRememberedState(): Promise<void> {
  stub(READY);
  window.localStorage.setItem(COPILOT_OPEN_KEY, "true");
  renderDock("admin");
  expect(await screen.findByRole("complementary", { name: "Copilot" })).toBeInTheDocument();
  window.localStorage.removeItem(COPILOT_OPEN_KEY);
}

export async function offersTheGlobalAdminThePlatformScopeByDefault(): Promise<void> {
  const stubs = stub(READY);
  renderDock("admin");
  await openPanel();
  const picker = await screen.findByRole("combobox", { name: "Organization" });
  expect(picker).toHaveDisplayValue("All organizations (platform key)");
  expect(screen.getByText(/Working in:/)).toHaveTextContent("Working in: All organizations (platform key)");
  await within(picker).findByRole("option", { name: "PHE Water" });
  await send("hi");
  await waitFor(() => expect(stubs.create).toHaveBeenCalledWith(null));
}

export async function bindsTheGlobalAdminsConversationToThePickedOrganization(): Promise<void> {
  const stubs = stub(READY);
  renderDock("admin");
  await openPanel();
  const picker = await screen.findByRole("combobox", { name: "Organization" });
  await within(picker).findByRole("option", { name: "PHE Water" });
  fireEvent.change(picker, { target: { value: ORG_ID } });
  expect(screen.getByText(/Working in:/)).toHaveTextContent("Working in: PHE Water");
  await waitFor(() => expect(stubs.status).toHaveBeenCalledWith(ORG_ID));
  await send("hi");
  await waitFor(() => expect(stubs.create).toHaveBeenCalledWith(ORG_ID));
}

export async function offersAScopedAdminNoPicker(): Promise<void> {
  const stubs = stub(READY);
  renderDock("location_admin");
  await openPanel();
  expect(screen.getByText(/Working in:/)).toHaveTextContent("Working in: your organization");
  expect(screen.queryByRole("combobox", { name: "Organization" })).not.toBeInTheDocument();
  expect(stubs.organizations).not.toHaveBeenCalled();
}

/** A page as `app.tsx` builds one: its own `AppShell`, so a route change unmounts the dock. */
function HomePage() {
  return (
    <AppShell user={asUser("admin")} kpiRibbon={null}>
      <LocationProbe />
    </AppShell>
  );
}

function AlarmsPage() {
  return (
    <AppShell user={asUser("admin")} kpiRibbon={null}>
      <LocationProbe />
    </AppShell>
  );
}

/**
 * Review code:F2 — `open_page` changes the route, and every page mounts its
 * own `AppShell`, so the dock unmounts. The thread, the conversation and the
 * global admin's pick must survive it: the reply stays on screen, the scope
 * stays, and the next turn goes to the same conversation.
 */
export async function keepsTheThreadAndThePickAcrossAnOpenPageNavigation(): Promise<void> {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  const stubs = stub(READY);
  const reload = vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue({
    id: CONVERSATION_ID,
    organizationId: ORG_ID,
    title: null,
    createdAt: "2026-10-11T10:00:00.000Z",
    lastTurnAt: "2026-10-11T10:00:00.000Z",
    messages: [],
    pendingChanges: [],
  });
  stubs.turn.mockResolvedValueOnce(answered("Show me the alarms", "Opening the Alarm Centre.", "/alarms"));
  useAuthStore.setState({ scope: { kind: "global", locations: [], assetGroups: [], assetIds: [] } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/alarms" element={<AlarmsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await openPanel();
  const picker = await screen.findByRole("combobox", { name: "Organization" });
  await within(picker).findByRole("option", { name: "PHE Water" });
  fireEvent.change(picker, { target: { value: ORG_ID } });
  await send("Show me the alarms");
  await waitFor(() => expect(screen.getByTestId("router-path")).toHaveTextContent(/^\/alarms$/));

  const thread = await screen.findByRole("log", { name: "Copilot conversation" });
  expect(await within(thread).findByText("Opening the Alarm Centre.")).toBeInTheDocument();
  expect(screen.getByText(/Working in:/)).toHaveTextContent("Working in: PHE Water");

  await send("And the critical ones?");
  await waitFor(() => expect(stubs.turn).toHaveBeenCalledTimes(2));
  expect(stubs.turn).toHaveBeenLastCalledWith(CONVERSATION_ID, "And the critical ones?");
  expect(stubs.create).toHaveBeenCalledTimes(1);
  expect(stubs.create).toHaveBeenCalledWith(ORG_ID);
  // The thread came from the query cache the turn wrote, not from a reload that could race it.
  expect(reload).not.toHaveBeenCalled();
}

/** A remembered conversation belongs to the user who made it: another user starts afresh. */
export async function startsAfreshForAnotherUser(): Promise<void> {
  const stubs = stub(READY);
  const reload = vi.spyOn(copilotApi, "fetchCopilotConversation");
  useCopilotStore.setState({ userId: "someone-else", organizationId: ORG_ID, conversationId: CONVERSATION_ID });
  renderDock("admin");
  await openPanel();
  expect(screen.getByText(/Working in:/)).toHaveTextContent("Working in: All organizations (platform key)");
  await send("hi");
  await waitFor(() => expect(stubs.create).toHaveBeenCalledWith(null));
  expect(reload).not.toHaveBeenCalled();
}

/** The shell mounts the dock: an admin on a real `AppShell` sees the button. */
export async function mountsTheDockInTheAppShell(): Promise<void> {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  stub(READY);
  useAuthStore.setState({ scope: { kind: "global", locations: [], assetGroups: [], assetIds: [] } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/alarms"]}>
        <AppShell user={asUser("admin")} kpiRibbon={null}>
          <p>page</p>
        </AppShell>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("button", OPEN_BUTTON)).toBeInTheDocument();
}

// ---------------------------------------------------------------------------
// `F3.87` PR 8 (ADR 0099 Amendment 3 A4, A7; plan §10, D2) — the attach
// control. It renders only when the scope's status says `attachmentsEnabled`
// (so never with no key, in the guided mode, or with the switch off), no skill
// is bound, and the conversation is bound to one organization. Its label and
// title say the file goes to the organization's AI provider unscrubbed.
// ---------------------------------------------------------------------------

/** The status the server sends for one organization whose copilot and attachment switches are on. */
export const READY_WITH_FILES: CopilotStatusDto = { available: true, configured: true, attachmentsEnabled: true };

const ATTACH = /AI provider as it is, unscrubbed/;
const SKILL_SESSION = "33333333-3333-4333-8333-333333333333";

function onboardingSkill(): CopilotSkillStateDto {
  return {
    kind: "onboarding",
    sessionId: SKILL_SESSION,
    session: {
      id: SKILL_SESSION,
      organizationId: ORG_ID,
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
    },
    suggestedReplies: [],
    validationErrors: [],
  } as unknown as CopilotSkillStateDto;
}

/** A remembered conversation of user `u1`, loaded from the server with this organization and skill. */
function rememberConversation(organizationId: string | null, skill: CopilotSkillStateDto | null) {
  useCopilotStore.setState({ userId: "u1", organizationId: "", conversationId: CONVERSATION_ID });
  return vi.spyOn(copilotApi, "fetchCopilotConversation").mockResolvedValue({
    id: CONVERSATION_ID,
    organizationId,
    title: null,
    createdAt: "2026-10-11T10:00:00.000Z",
    lastTurnAt: "2026-10-11T10:00:00.000Z",
    messages: [],
    pendingChanges: [],
    skill,
  });
}

function aFile(name: string, size = 3, type = ""): File {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type });
  // The size is what the dock reads; no 10 MB buffer is allocated for it.
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function choose(...files: File[]): void {
  fireEvent.change(screen.getByLabelText(ATTACH), { target: { files } });
}

function chips(): string[] {
  const list = screen.queryByRole("list", { name: "Files to attach" });
  return list === null ? [] : within(list).getAllByRole("listitem").map((li) => li.getAttribute("data-name") ?? "");
}

/**
 * (1) The guided mode: a skill bound with no AI key answers through the skill panel, which has no attach control.
 *
 * Not a gate on its own: the stub sets `configured: false`, `attachmentsEnabled: false` and a bound
 * skill together, so removing any one of those checks in `attachAllowed` keeps this case green. The
 * guided mode and a missing key both reach the dock as the server's `attachmentsEnabled: false`, so
 * case (3) (the switch alone) and case (4) (the skill alone) are the cases a mutation reddens.
 */
export async function offersNoAttachInTheGuidedMode(): Promise<void> {
  stub({ available: true, configured: false, attachmentsEnabled: false });
  rememberConversation(ORG_ID, onboardingSkill());
  renderDock("organization_admin");
  await openPanel();
  expect(await screen.findByText("Welcome to onboarding.")).toBeInTheDocument();
  await settle();
  expect(screen.queryByLabelText(ATTACH)).not.toBeInTheDocument();
}

/**
 * (2) No AI key for the scope: the sentence shows, and no attach control.
 *
 * Not a gate on its own either, for the reason case (1) gives: `configured: false` and
 * `attachmentsEnabled: false` each hide the control. Cases (3) and (4) are the gates.
 */
export async function offersNoAttachWithNoKey(): Promise<void> {
  stub({ available: true, configured: false, attachmentsEnabled: false });
  renderDock("organization_admin");
  await openPanel();
  expect(await screen.findByText(/no AI key is set up/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(ATTACH)).not.toBeInTheDocument();
}

/** (3) The organization's attachment switch is off: the composer shows, the attach control does not. */
export async function offersNoAttachWithTheSwitchOff(): Promise<void> {
  stub({ available: true, configured: true, attachmentsEnabled: false });
  renderDock("organization_admin");
  await openPanel();
  expect(await screen.findByRole("textbox", { name: "Message the copilot" })).toBeInTheDocument();
  await settle();
  expect(screen.queryByLabelText(ATTACH)).not.toBeInTheDocument();
}

/** (4) A skill is bound, the key and the switch on: still no attach control (the server refuses files in a skill). */
export async function offersNoAttachWhileASkillIsActive(): Promise<void> {
  stub(READY_WITH_FILES);
  rememberConversation(ORG_ID, onboardingSkill());
  renderDock("organization_admin");
  await openPanel();
  expect(await screen.findByText("Welcome to onboarding.")).toBeInTheDocument();
  await settle();
  expect(screen.queryByLabelText(ATTACH)).not.toBeInTheDocument();
}

/**
 * (5) A cross-organization conversation (plan D2). The status is stubbed to say
 * `attachmentsEnabled`, so the conversation's own organization is the only
 * thing that keeps the control away.
 */
export async function offersNoAttachInACrossOrganizationConversation(): Promise<void> {
  stub(READY_WITH_FILES);
  const load = rememberConversation(null, null);
  renderDock("admin");
  await openPanel();
  expect(await screen.findByRole("textbox", { name: "Message the copilot" })).toBeInTheDocument();
  await waitFor(() => expect(load).toHaveBeenCalledWith(CONVERSATION_ID));
  await settle();
  expect(screen.queryByLabelText(ATTACH)).not.toBeInTheDocument();
}

/** Present: a scoped administrator, the key and the switch on, no skill, the home organization's conversation. */
export async function offersAttachWithTheUnscrubbedSentence(): Promise<void> {
  stub(READY_WITH_FILES);
  renderDock("organization_admin");
  await openPanel();
  const input = await screen.findByLabelText(ATTACH);
  expect(input).toHaveAttribute("type", "file");
  expect(input).toHaveAttribute("accept", ".png,.jpg,.jpeg,.webp,.pdf,.svg");
  expect(input).toHaveAttribute("multiple");
  const sentence = "The file goes to your organization's AI provider as it is, unscrubbed.";
  expect(screen.getByTitle(sentence)).toBeInTheDocument();
  expect(input).toHaveAccessibleName(`Attach files. ${sentence}`);
  // A7: the sentence is on screen, not only in a tooltip and an accessible name.
  expect(screen.getByText(sentence)).toBeVisible();
}

/** Present in a remembered conversation bound to the organization: the positive twin of (5). */
export async function offersAttachInAConversationBoundToTheOrganization(): Promise<void> {
  stub(READY_WITH_FILES);
  const load = rememberConversation(ORG_ID, null);
  renderDock("organization_admin");
  await openPanel();
  await waitFor(() => expect(load).toHaveBeenCalledWith(CONVERSATION_ID));
  expect(await screen.findByLabelText(ATTACH)).toBeInTheDocument();
}

/** The global administrator's picked organization is named in the sentence. */
export async function namesThePickedOrganizationInTheSentence(): Promise<void> {
  stub(READY_WITH_FILES);
  renderDock("admin");
  await openPanel();
  const picker = await screen.findByRole("combobox", { name: "Organization" });
  await within(picker).findByRole("option", { name: "PHE Water" });
  fireEvent.change(picker, { target: { value: ORG_ID } });
  expect(await screen.findByTitle("The file goes to PHE Water's AI provider as it is, unscrubbed.")).toBeInTheDocument();
}

/** The global administrator's "All organizations" scope never offers the control, whatever the status says. */
export async function offersNoAttachOnThePlatformScope(): Promise<void> {
  stub(READY_WITH_FILES);
  renderDock("admin");
  await openPanel();
  expect(await screen.findByRole("textbox", { name: "Message the copilot" })).toBeInTheDocument();
  await settle();
  expect(screen.queryByLabelText(ATTACH)).not.toBeInTheDocument();
}

const ORG_2 = "44444444-4444-4444-8444-444444444444";

/**
 * A pick of another organization drops the chosen files, even when the control never goes away: the
 * status of the organization picked back is cached as on, so `attachAllowed` stays true across the
 * pick. The user agreed to send the file to the old organization's provider only.
 */
export async function dropsTheChosenFilesOnAPickOfAnotherOrganization(): Promise<void> {
  const stubs = stub(READY_WITH_FILES);
  stubs.organizations.mockResolvedValue({
    items: [
      { id: ORG_ID, code: "PHE", name: "PHE Water", active: true, currency: "INR", timezone: "Asia/Kolkata", meta: null },
      { id: ORG_2, code: "ION", name: "Ion Plant", active: true, currency: "INR", timezone: "Asia/Kolkata", meta: null },
    ],
  } as never);
  renderDock("admin");
  await openPanel();
  const picker = await screen.findByRole("combobox", { name: "Organization" });
  await within(picker).findByRole("option", { name: "Ion Plant" });
  fireEvent.change(picker, { target: { value: ORG_ID } });
  await screen.findByTitle("The file goes to PHE Water's AI provider as it is, unscrubbed.");
  fireEvent.change(picker, { target: { value: ORG_2 } });
  await screen.findByTitle("The file goes to Ion Plant's AI provider as it is, unscrubbed.");
  choose(aFile("plant.png"));
  expect(chips()).toEqual(["plant.png"]);
  fireEvent.change(picker, { target: { value: ORG_ID } });
  // PHE Water's status is cached: the control is there at once, so only the pick itself can drop the file.
  expect(screen.getByTitle("The file goes to PHE Water's AI provider as it is, unscrubbed.")).toBeInTheDocument();
  await settle();
  expect(screen.getByLabelText(ATTACH)).toBeInTheDocument();
  expect(chips()).toEqual([]);
}

export async function showsAChipPerChosenFile(): Promise<void> {
  stub(READY_WITH_FILES);
  renderDock("organization_admin");
  await openPanel();
  await screen.findByLabelText(ATTACH);
  choose(aFile("plant.png"), aFile("sld.PDF"), aFile("valve.svg"));
  expect(chips()).toEqual(["plant.png", "sld.PDF", "valve.svg"]);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
}

export async function refusesAFourthFile(): Promise<void> {
  stub(READY_WITH_FILES);
  renderDock("organization_admin");
  await openPanel();
  await screen.findByLabelText(ATTACH);
  choose(aFile("a.png"), aFile("b.png"), aFile("c.png"));
  choose(aFile("d.png"));
  expect(chips()).toEqual(["a.png", "b.png", "c.png"]);
  expect(screen.getByRole("alert")).toHaveTextContent("A message can carry at most 3 files.");
}

/** Owner ruling 2026-10-16: files that pass alone but exceed 10 MB together are refused. Mutation: drop the total check → red. */
export async function refusesFilesOverTenMegabytesTogether(): Promise<void> {
  stub(READY_WITH_FILES);
  renderDock("organization_admin");
  await openPanel();
  await screen.findByLabelText(ATTACH);
  choose(aFile("a.png", 6_000_000), aFile("b.png", 4_000_000));
  choose(aFile("c.png", 1));
  expect(chips()).toEqual(["a.png", "b.png"]);
  expect(screen.getByRole("alert")).toHaveTextContent("The files of one message may be at most 10 MB together.");
}

export async function refusesAFileTypeNotInTheList(): Promise<void> {
  stub(READY_WITH_FILES);
  renderDock("organization_admin");
  await openPanel();
  await screen.findByLabelText(ATTACH);
  choose(aFile("plant.gif", 3, "image/gif"), aFile("plant.png"));
  expect(chips()).toEqual(["plant.png"]);
  expect(screen.getByRole("alert")).toHaveTextContent('"plant.gif" is not a PNG, JPEG, WebP, PDF or SVG file.');
}

export async function refusesAFileOverTenMegabytes(): Promise<void> {
  stub(READY_WITH_FILES);
  renderDock("organization_admin");
  await openPanel();
  await screen.findByLabelText(ATTACH);
  choose(aFile("big.png", MAX_COPILOT_ATTACHMENT_BYTES + 1), aFile("ok.png", MAX_COPILOT_ATTACHMENT_BYTES));
  expect(chips()).toEqual(["ok.png"]);
  expect(screen.getByRole("alert")).toHaveTextContent('"big.png" is larger than 10 MB.');
}

/** An `.svg` is a symbol candidate: its limit is the symbol upload's 64 KB, not 10 MB. */
export async function refusesAnSvgOverSixtyFourKilobytes(): Promise<void> {
  stub(READY_WITH_FILES);
  renderDock("organization_admin");
  await openPanel();
  await screen.findByLabelText(ATTACH);
  choose(aFile("big.svg", MAX_MIMIC_SYMBOL_SVG_BYTES + 1), aFile("ok.svg", MAX_MIMIC_SYMBOL_SVG_BYTES));
  expect(chips()).toEqual(["ok.svg"]);
  expect(screen.getByRole("alert")).toHaveTextContent('"big.svg" is larger than 64 KB.');
}

export async function removesAChip(): Promise<void> {
  stub(READY_WITH_FILES);
  renderDock("organization_admin");
  await openPanel();
  await screen.findByLabelText(ATTACH);
  choose(aFile("a.png"), aFile("b.pdf"));
  fireEvent.click(screen.getByRole("button", { name: "Remove a.png" }));
  expect(chips()).toEqual(["b.pdf"]);
}

/**
 * The chosen files reach the wire as `FormData` through the real
 * `sendCopilotTurn`: `message`, then three `files` entries, no `Content-Type`.
 */
export async function sendsTheChosenFilesAsFormData(): Promise<void> {
  const stubs = stub(READY_WITH_FILES);
  stubs.turn.mockRestore();
  const seen: { body: unknown; headers: Headers | null } = { body: null, headers: null };
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    seen.body = init.body;
    seen.headers = new Headers(init.headers);
    return new Response(JSON.stringify(answered("draw it", "Here is the drawing.")), { status: 200 });
  });
  renderDock("organization_admin");
  await openPanel();
  await screen.findByLabelText(ATTACH);
  choose(aFile("a.png"), aFile("b.pdf"), aFile("c.svg"));
  await send("draw it");
  await waitFor(() => expect(seen.body).not.toBeNull());
  expect(seen.body).toBeInstanceOf(FormData);
  const form = seen.body as FormData;
  expect([...form.keys()]).toEqual(["message", "files", "files", "files"]);
  expect(form.get("message")).toBe("draw it");
  expect(form.getAll("files").map((f) => (f as File).name)).toEqual(["a.png", "b.pdf", "c.svg"]);
  expect(seen.headers?.get("Content-Type")).toBeNull();
}

export async function clearsTheChipsAfterTheTurnIsAnswered(): Promise<void> {
  const stubs = stub(READY_WITH_FILES);
  stubs.turn.mockResolvedValue(answered("draw it", "Here is the drawing."));
  renderDock("organization_admin");
  await openPanel();
  await screen.findByLabelText(ATTACH);
  choose(aFile("a.png"));
  await send("draw it");
  await waitFor(() => expect(stubs.turn).toHaveBeenCalledWith(CONVERSATION_ID, "draw it", [expect.any(File)]));
  expect(await screen.findByText("Here is the drawing.")).toBeInTheDocument();
  expect(chips()).toEqual([]);
}

/** A turn with no file keeps the two-argument call: nothing changes for a plain turn. */
export async function sendsAPlainTurnWithoutAFileList(): Promise<void> {
  const stubs = stub(READY_WITH_FILES);
  renderDock("organization_admin");
  await openPanel();
  await screen.findByLabelText(ATTACH);
  await send("hello");
  await waitFor(() => expect(stubs.turn).toHaveBeenCalledTimes(1));
  expect(stubs.turn.mock.calls[0]).toEqual([CONVERSATION_ID, "hello"]);
}

const PLACEHOLDER = `[Attachment 1 of 2: "plant.png", image/png, 12 bytes, sha256 ${"a".repeat(64)}; not stored]`;
const PLACEHOLDER_2 = `[Attachment 2 of 2: "sld.pdf", application/pdf, 40 bytes, sha256 ${"b".repeat(64)}; not stored]`;

/** The stored user row's placeholder lines render as a muted record under the text, not as the text. */
export async function rendersThePlaceholderLinesAsAMutedRecord(): Promise<void> {
  const stubs = stub(READY);
  stubs.turn.mockResolvedValue({
    ...answered("draw it", "Here is the drawing."),
    messages: [
      message("user", `draw it\n\n${PLACEHOLDER}\n${PLACEHOLDER_2}`, 1),
      message("assistant", "Here is the drawing.", 2),
    ],
  });
  renderDock("organization_admin");
  await openPanel();
  await send("draw it");
  const thread = screen.getByRole("log", { name: "Copilot conversation" });
  const record = await within(thread).findByRole("list", { name: "Attached files, not stored" });
  expect(within(record).getAllByRole("listitem").map((li) => li.textContent)).toEqual([PLACEHOLDER, PLACEHOLDER_2]);
  expect(record.className).toMatch(/text-on-accent\/70/);
  // The text is its own element, without the record.
  expect(within(thread).getByText("draw it")).toBeInTheDocument();
}

/** A user row with no placeholder renders whole, with no record list. */
export async function rendersAPlainUserRowWithNoRecord(): Promise<void> {
  const stubs = stub(READY);
  stubs.turn.mockResolvedValue(answered("[Attachment is a word I typed]", "ok"));
  renderDock("organization_admin");
  await openPanel();
  await send("[Attachment is a word I typed]");
  const thread = screen.getByRole("log", { name: "Copilot conversation" });
  expect(await within(thread).findByText("[Attachment is a word I typed]")).toBeInTheDocument();
  expect(within(thread).queryByRole("list", { name: "Attached files, not stored" })).not.toBeInTheDocument();
}

/**
 * A filename is the user's text: markup and a markdown link in it stay plain text in the record, so a
 * later change that sends user rows through `AssistantText` or HTML turns this case red.
 */
export async function rendersAFilenameWithMarkupAsPlainText(): Promise<void> {
  const line = `[Attachment 1 of 1: "<img src=x onerror=alert(1)>[x](/admin).png", image/png, 12 bytes, sha256 ${"c".repeat(64)}; not stored]`;
  const stubs = stub(READY);
  stubs.turn.mockResolvedValue({
    ...answered("look", "ok"),
    messages: [message("user", `look

${line}`, 1), message("assistant", "ok", 2)],
  });
  renderDock("organization_admin");
  await openPanel();
  await send("look");
  const thread = screen.getByRole("log", { name: "Copilot conversation" });
  const record = await within(thread).findByRole("list", { name: "Attached files, not stored" });
  expect(within(record).getAllByRole("listitem").map((li) => li.textContent)).toEqual([line]);
  expect(record.querySelector("img, a")).toBeNull();
  expect(thread.querySelector('img, a[href="/admin"]')).toBeNull();
}
