/**
 * `F4.199`: the phrases the client never offers as a button — "confirm commit"
 * (ADR 0090 decision 5) and "undo" (ADR 0094 decision 9: undo has its own control).
 */
const NEVER_OFFERED_REPLIES: readonly string[] = ["confirm commit", "undo"];

/**
 * The replies to render: the server's list, minus the acting phrases (trim,
 * lower case). One rule for the onboarding page and the copilot dock's
 * onboarding skill (`F3.86` PR 6).
 */
export function offeredReplies(replies: readonly string[] | undefined): string[] {
  return (replies ?? []).filter((r) => !NEVER_OFFERED_REPLIES.includes(r.trim().toLowerCase()));
}
