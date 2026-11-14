import { type AgentStopReason, MAX_TOOL_CALLS_PER_TURN, TURN_DEADLINE_MS } from "../llm/agent-loop";

/**
 * `F4.294` — the reply for a copilot turn that did not end `final`, moved out of
 * `copilot-turn.service.ts` by `F4.360` (the 1000-line cap), which re-exports them.
 */

/** The model call failed (`provider_error`), or the change's organization left the key's scope; nothing is stored (a follow-up stores its outcome line only); a cap stores the message and cause (`F4.360`). */
export const COPILOT_TURN_FAILED_REPLY = "The assistant could not answer just now. Try again in a moment.";

/** `F4.294`: the deadline (`cap_time`) stopped the turn; the limit in the text is the loop's own. */
export const COPILOT_TURN_DEADLINE_REPLY =
  `The assistant ran out of time before it could answer (the limit is ${TURN_DEADLINE_MS / 1000} seconds). ` +
  "Ask for less at a time, for example one site or one device, and try again.";

/** `F4.294`: the call cap (`cap_calls`) stopped the turn; it counts every tool call, reads and proposals alike. */
export const COPILOT_TURN_CALL_CAP_REPLY =
  `The assistant needed more than ${MAX_TOOL_CALLS_PER_TURN} steps (data reads or proposed changes) to answer this. ` +
  "Ask for less at a time, for example one site, one device or a few changes.";

/** `F4.294`: the reply for each stop that is not `final` — a cap names itself, a provider error keeps the plain reply. */
export function copilotStopReply(stop: Exclude<AgentStopReason, "final">): string {
  if (stop === "cap_time") return COPILOT_TURN_DEADLINE_REPLY;
  if (stop === "cap_calls") return COPILOT_TURN_CALL_CAP_REPLY;
  return COPILOT_TURN_FAILED_REPLY;
}

/**
 * `F4.360` defect 2: a user turn stopped by a cap (the deadline or the call cap) stores the user's message and the
 * cause, so the message stays in the thread (AWS, 2026-11-14: it vanished). A provider error stores nothing, as before.
 */
export function keepsTheMessage(stop: Exclude<AgentStopReason, "final">): boolean {
  return stop === "cap_time" || stop === "cap_calls";
}
