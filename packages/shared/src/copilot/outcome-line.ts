/**
 * `F4.244` — whether a message's text is a confirmed change's outcome line:
 * the exact shape `changeOutcomeLine` writes
 * (`apps/api/src/copilot/copilot-turn.service.ts`) — `Applied: <summary>`, or
 * `Failed…: <summary>` with an optional HTTP status. The `role === "action"`
 * check stays with the caller. The Reject line (`Rejected: …`) is an action
 * line too, and it is not an outcome: no follow-up turn runs after a Reject.
 *
 * One definition for the dock's in-tab wait and the API's binding spec, so
 * the producer and its two readers cannot drift apart.
 */
export function isCopilotOutcomeLine(content: string): boolean {
  return content.startsWith("Applied: ") || content.startsWith("Failed");
}
