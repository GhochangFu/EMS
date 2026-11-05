import { expect } from "vitest";

import { calls, FakeLlmProvider, toolCall } from "../admin/onboarding/onboarding-agent-loop.spec";
import { COPILOT_OUT_OF_SCOPE_TOOL_ERROR } from "./copilot-turn.service";
import { harness, ORG_X, ORG_Y, turn } from "./copilot-turn.service.spec";

/**
 * `F4.315` PR A review (security M1; ADR 0099 decision 10, SEC-PR7-1) — a
 * tool call that fails with a sentence naming records (`assetTemplate.adopt`'s
 * named refusal: the version's code and number, the asset's code, and for an
 * organization refusal the other organization's asset) carries the
 * organizations those records belong to, and the turn records them in its
 * provenance, so history drops the sentence once an organization leaves the
 * allowed set. The propose tool's side (which ids a refusal names) is
 * `copilot-propose-adopt-refusal.spec.ts`'s; here a fake tool answers the
 * failure, as the turn service treats every tool's failure alike.
 *
 * Mutation, applied once and seen red: drop the failure's ids from `read` in
 * the turn service ({@link aNamedRefusalIsStoredWithItsOrganization}).
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const NAMED = 'Asset "PHE-MFM-2" is already pinned to a template version, so there is nothing to adopt from template "TPL" v2.';

function refusalTurn(organizationIds: string[]) {
  const llm = new FakeLlmProvider([calls(toolCall("propose_fake", {})), { kind: "final", text: "It is pinned." }]);
  const h = harness(llm, {
    conversationOrg: null,
    platform: { kind: "ready", allowed: [ORG_X, ORG_Y] },
    tools: { propose_fake: () => ({ ok: false, error: NAMED, organizationIds }) },
  });
  return { h, llm };
}

/** A turn whose only tool call is a named refusal of organization X is stored with provenance [X], not []. */
export async function aNamedRefusalIsStoredWithItsOrganization(): Promise<void> {
  const { h } = refusalTurn([ORG_X]);
  const out = await turn(h, "adopt TPL v2 for PHE-MFM-2");
  expect(out.messages.find((m) => m.role === "assistant")?.organizationIds).toEqual([ORG_X]);
}

/** An organization refusal naming X and Y is stored with provenance [X, Y]. */
export async function anOrganizationRefusalIsStoredWithBothOrganizations(): Promise<void> {
  const { h } = refusalTurn([ORG_X, ORG_Y]);
  const out = await turn(h, "adopt TPL v2 for PHE-MFM-2");
  expect([...(out.messages.find((m) => m.role === "assistant")?.organizationIds ?? [])].sort()).toEqual([ORG_X, ORG_Y].sort());
}

/** The model reads the refusal's sentence as the tool's answer. */
export async function theModelReadsTheSentence(): Promise<void> {
  const { h, llm } = refusalTurn([ORG_X]);
  await turn(h, "adopt TPL v2 for PHE-MFM-2");
  expect(JSON.stringify(llm.seen[1])).toContain("already pinned to a template version");
}

/** A failure naming an organization outside the allowed set is the out-of-scope error, never its sentence. */
export async function aRefusalOutsideTheAllowedSetIsTheOutOfScopeError(): Promise<void> {
  const { h, llm } = refusalTurn([ORG_X, "00000000-0000-4000-8000-0000000000ff"]);
  await turn(h, "adopt TPL v2 for PHE-MFM-2");
  const seen = JSON.stringify(llm.seen[1]);
  expect([seen.includes(COPILOT_OUT_OF_SCOPE_TOOL_ERROR), seen.includes("already pinned")]).toEqual([true, false]);
}
