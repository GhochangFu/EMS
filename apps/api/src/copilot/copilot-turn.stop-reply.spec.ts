import { expect, vi } from "vitest";

import { calls, FakeLlmProvider, toolCall } from "../admin/onboarding/onboarding-agent-loop.spec";
import { MAX_TOOL_CALLS_PER_TURN, TURN_DEADLINE_MS } from "../llm/agent-loop";
import {
  COPILOT_TURN_CALL_CAP_REPLY,
  COPILOT_TURN_DEADLINE_REPLY,
  COPILOT_TURN_FAILED_REPLY,
  copilotStopReply,
  usageLimitFollowUpReply,
  usageLimitMessage,
} from "./copilot-turn.service";
import { APPLIED, CHANGE_ID, GLOBAL_ADMIN, harness, JWT, ORG_X, turn } from "./copilot-turn.service.spec";

/**
 * `F4.294` — a failed copilot turn says why. The AWS demo log of 2026-10-27
 * had 5 of 20 turns stop on `cap_time`, and every stop showed the same
 * "could not answer just now". Each stop reason is driven here to its own
 * reply, on a user turn and on a follow-up. Vitest entry point: the sibling
 * `.test.ts`.
 */

type Harness = ReturnType<typeof harness>;

const READ_TOOLS = { list_assets: () => ({ ok: true as const, result: { items: [] }, organizationIds: [ORG_X] }) };

/** One more read than the cap allows: the loop stops on `cap_calls`. */
function overTheCap(): FakeLlmProvider {
  return new FakeLlmProvider([calls(...Array.from({ length: MAX_TOOL_CALLS_PER_TURN + 1 }, () => toolCall("list_assets", {})))]);
}

function followUp(h: Harness) {
  return h.service.followUp({ identity: GLOBAL_ADMIN, user: JWT }, CHANGE_ID);
}

/** Runs `start` under fake timers and moves the clock past the deadline. */
async function pastTheDeadline<T>(start: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    const pending = start();
    await vi.advanceTimersByTimeAsync(TURN_DEADLINE_MS);
    return await pending;
  } finally {
    vi.useRealTimers();
  }
}

/** The deadline reply names the loop's own limit in seconds, and the cap reply the loop's own cap. */
export function theRepliesNameTheLoopLimits(): void {
  expect([
    COPILOT_TURN_DEADLINE_REPLY.includes(`${TURN_DEADLINE_MS / 1000} seconds`),
    COPILOT_TURN_CALL_CAP_REPLY.includes(`more than ${MAX_TOOL_CALLS_PER_TURN} steps`),
  ]).toEqual([true, true]);
}

/** Three stop reasons, three different replies. Mutation: map `cap_calls` to the deadline reply → red. */
export function eachStopReasonHasItsOwnReply(): void {
  expect([copilotStopReply("cap_time"), copilotStopReply("cap_calls"), copilotStopReply("provider_error")]).toEqual([
    COPILOT_TURN_DEADLINE_REPLY,
    COPILOT_TURN_CALL_CAP_REPLY,
    COPILOT_TURN_FAILED_REPLY,
  ]);
}

/** A user turn that reaches the deadline says so. */
export async function aUserTurnPastTheDeadlineSaysSo(): Promise<void> {
  const h = harness(new FakeLlmProvider(["hang"]));
  const response = await pastTheDeadline(() => turn(h, "show every point at every site"));
  expect(response).toMatchObject({ outcome: "failed", reply: COPILOT_TURN_DEADLINE_REPLY });
}

/** A user turn over the call cap says so. */
export async function aUserTurnOverTheCapSaysSo(): Promise<void> {
  const response = await turn(harness(overTheCap(), { tools: READ_TOOLS }), "list everything");
  expect(response).toMatchObject({ outcome: "failed", reply: COPILOT_TURN_CALL_CAP_REPLY });
}

/** A provider error keeps the plain reply: the cause is not the user's to fix. */
export async function aProviderErrorKeepsThePlainReply(): Promise<void> {
  const response = await turn(harness(new FakeLlmProvider(["reject"])), "any alarms?");
  expect(response).toMatchObject({ outcome: "failed", reply: COPILOT_TURN_FAILED_REPLY });
}

/** What a follow-up leaves for the user: the stored rows after the change's outcome line. */
function storedAfterTheOutcome(h: Harness): Array<[string, string]> {
  return h.history.slice(1).map((m) => [m.role, m.content]);
}

/** A follow-up that reaches the deadline stores the cause after its outcome line. Mutation: keep the outcome line alone → red. */
export async function aFollowUpPastTheDeadlineSaysSo(): Promise<void> {
  const h = harness(new FakeLlmProvider(["hang"]), { finished: APPLIED });
  await pastTheDeadline(() => followUp(h));
  expect([h.history[0]?.role, storedAfterTheOutcome(h)]).toEqual(["action", [["assistant", COPILOT_TURN_DEADLINE_REPLY]]]);
}

/** A follow-up over the call cap stores that cause. */
export async function aFollowUpOverTheCapSaysSo(): Promise<void> {
  const h = harness(overTheCap(), { tools: READ_TOOLS, finished: APPLIED });
  await followUp(h);
  expect(storedAfterTheOutcome(h)).toEqual([["assistant", COPILOT_TURN_CALL_CAP_REPLY]]);
}

/** A provider error on a follow-up stores the outcome line alone, as before `F4.294`. */
export async function aFollowUpProviderErrorStoresNoCause(): Promise<void> {
  const h = harness(new FakeLlmProvider(["reject"]), { finished: APPLIED });
  await followUp(h);
  expect(h.history.map((m) => m.role)).toEqual(["action"]);
}

/** A follow-up after the user's daily limit stores the limit's words and its reset time (ADR 0099 decision 11), and calls no model. */
export async function aFollowUpOverTheUserLimitSaysSo(): Promise<void> {
  const llm = new FakeLlmProvider([{ kind: "final", text: "never asked" }]);
  const h = harness(llm, { finished: APPLIED, usage: { ok: false, scope: "user", resetsAt: "2026-11-01T00:00:00.000Z" } });
  await followUp(h);
  expect([storedAfterTheOutcome(h), llm.calls]).toEqual([[["assistant", `${usageLimitMessage("user")} It resets at 2026-11-01 00:00 UTC.`]], 0]);
}

/** The organization's limit gets its own words, and the cause row carries no organization. Mutation: ignore `scope` → red. */
export async function aFollowUpOverTheOrganizationLimitSaysSo(): Promise<void> {
  const h = harness(new FakeLlmProvider([]), {
    finished: APPLIED,
    usage: { ok: false, scope: "organization", resetsAt: "2026-11-01T00:00:00.000Z" },
  });
  await followUp(h);
  const cause = h.history[1];
  expect([cause?.content, cause?.organizationIds, usageLimitMessage("organization") !== usageLimitMessage("user")]).toEqual([
    usageLimitFollowUpReply({ scope: "organization", resetsAt: "2026-11-01T00:00:00.000Z" }),
    [],
    true,
  ]);
}
