import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { expect, vi } from "vitest";

import type {
  CopilotMessageDto,
  CopilotPendingChangeDto,
  CopilotStatusDto,
  CopilotTurnResponseDto,
  UserRole,
} from "@bms/shared";

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

export async function showsNoButtonOnTheOnboardingChat(): Promise<void> {
  const stubs = stub(READY);
  renderDock("admin", `/admin/organizations/${ORG_ID}/onboarding`);
  await settle();
  expect(screen.getByTestId("router-path")).toHaveTextContent(`/admin/organizations/${ORG_ID}/onboarding`);
  expect(screen.queryByRole("button", OPEN_BUTTON)).not.toBeInTheDocument();
  expect(stubs.status).not.toHaveBeenCalled();
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
