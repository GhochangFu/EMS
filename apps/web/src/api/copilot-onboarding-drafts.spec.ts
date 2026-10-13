import { expect, vi } from "vitest";

import { fetchOnboardingDrafts } from "./admin/onboarding";
import { startCopilotOnboardingSkill } from "./copilot";

/**
 * `F4.255` PR 3 (plan §6.1, ADR 0099 Amendment 2 A1) — the two clients the
 * dock's draft list needs: the organization's draft list, and a skill start
 * that resumes a draft when it names one.
 *
 * Assertions live here; `copilot-onboarding-drafts.test.ts` is the Vitest entry
 * point (ADR 0014). It runs in the web project's default `node` environment:
 * `fetch` is a stub that records each request, so nothing leaves the process.
 */

const ORG = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "11111111-1111-4111-8111-111111111111";
const SESSION = "33333333-3333-4333-8333-333333333333";

type Sent = { url: string; init: RequestInit | undefined };

/** Every request answers `body` with a 200; the list records what was sent. */
function recordFetch(body: unknown): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    sent.push({ url, init });
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  return sent;
}

const DETAIL = {
  id: CONVERSATION,
  organizationId: ORG,
  title: null,
  createdAt: "2026-10-13T00:00:00.000Z",
  lastTurnAt: "2026-10-13T00:00:00.000Z",
  messages: [],
  pendingChanges: [],
  skill: null,
};

/** The list reads the organization-scoped route with the id in the query. */
export async function theDraftListReadsTheOrganizationRoute(): Promise<void> {
  const sent = recordFetch({ items: [] });
  await fetchOnboardingDrafts(ORG);
  expect(sent).toHaveLength(1);
  expect(sent[0]?.url).toMatch(new RegExp(`/api/v1/admin/onboarding/sessions\\?organizationId=${ORG}$`));
}

/** With no organization the list reads the bare route: no query string, so the server answers for the home organization. */
export async function theHomeDraftListSendsNoQueryString(): Promise<void> {
  const sent = recordFetch({ items: [] });
  await fetchOnboardingDrafts();
  expect(sent).toHaveLength(1);
  expect(sent[0]?.url).toMatch(/\/api\/v1\/admin\/onboarding\/sessions$/);
}

/** One summary item, as the server answers it. */
const SUMMARY = {
  id: SESSION,
  organizationId: ORG,
  currentPhase: "location",
  locationName: null,
  createdAt: "2026-10-13T00:00:00.000Z",
  updatedAt: "2026-10-13T00:00:00.000Z",
  createdBy: null,
};

/**
 * The list's answer is checked against the shared contract: an item that carries the draft is
 * refused as an unrecognized key on that item (the contract error carries the path and code, never
 * the key's name or value). The positive control: the same item without `draft` resolves, so the
 * refusal is the key's and not the fixture's.
 */
export async function theDraftListRefusesAnItemThatCarriesTheDraft(): Promise<void> {
  recordFetch({ items: [{ ...SUMMARY, draft: {} }] });
  await expect(fetchOnboardingDrafts(ORG)).rejects.toMatchObject({
    name: "ResponseContractError",
    issues: [{ path: "items.0", code: "unrecognized_keys" }],
  });

  recordFetch({ items: [SUMMARY] });
  await expect(fetchOnboardingDrafts(ORG)).resolves.toEqual({ items: [SUMMARY] });
}

/** A start without a session id sends the organization alone: the body has no `sessionId` key. */
export async function aStartSendsNoSessionIdKey(): Promise<void> {
  const sent = recordFetch(DETAIL);
  await startCopilotOnboardingSkill(CONVERSATION, ORG);
  expect(JSON.parse(String(sent[0]?.init?.body))).toEqual({ organizationId: ORG });
  expect(String(sent[0]?.init?.body)).not.toContain("sessionId");
}

/** A resume sends the organization and the session id. */
export async function aResumeSendsTheSessionId(): Promise<void> {
  const sent = recordFetch(DETAIL);
  await startCopilotOnboardingSkill(CONVERSATION, ORG, SESSION);
  expect(sent[0]?.url).toMatch(new RegExp(`/copilot/conversations/${CONVERSATION}/skills/onboarding$`));
  expect(sent[0]?.init?.method).toBe("POST");
  expect(JSON.parse(String(sent[0]?.init?.body))).toEqual({ organizationId: ORG, sessionId: SESSION });
}
