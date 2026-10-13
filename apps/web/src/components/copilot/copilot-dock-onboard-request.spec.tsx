import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { CopilotConversationDetailDto, CopilotSkillStateDto, UserRole } from "@bms/shared";

import * as copilotApi from "../../api/copilot";
import type { AuthUser } from "../../stores/auth-store";
import { useCopilotStore } from "../../stores/copilot-store";
import { CopilotDock } from "./copilot-dock";
import { CONVERSATION_ID, READY, stub } from "./copilot-dock.spec";

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
