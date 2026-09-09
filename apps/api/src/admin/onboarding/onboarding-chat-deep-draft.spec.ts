import { chatService } from "./onboarding-chat.service.spec";

/**
 * `mergeDraft`'s half of `F4.115` ruling 2b, in its own file.
 *
 * `onboarding-chat.service.spec.ts` is 996 lines and AGENTS.md §4.5 caps a file
 * at 1000, so this is the split `onboarding-chat-caps.spec.ts` and
 * `onboarding-chat-summary-caps.spec.ts` already made for the same reason. The
 * service is built by that file's exported `chatService()` rather than
 * reconstructed here — a second copy would give the two files two different
 * services, and only one of them would still be the one the docblock describes.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * As deep as the redaction fixtures, and set for the same measured reason —
 * see `onboarding-redaction.spec.ts`, where 5,000 was found to leave a
 * recursive walker green under vitest's larger worker stack.
 */
const DEEP_CONFIG_LEVELS = 20_000;

/** Built with a loop — a recursive builder throws before `mergeDraft` does. */
function deepConfig(): Record<string, unknown> {
  let node: Record<string, unknown> = { password: "hunter2" };
  for (let level = 0; level < DEEP_CONFIG_LEVELS; level += 1) {
    node = { next: node };
  }
  return node;
}

/**
 * The recovery `PATCH` — ruling 2b's second half, **and nothing else covers it
 * at the unit level**.
 *
 * `patchDraft` calls `mergeDraft(session.draft, draft)`, and `mergeDraft`
 * deep-clones the *stored* value before it replaces anything. So a session
 * stored too deep could not be repaired by the one request that would have
 * repaired it: the clone threw a `RangeError` before the patch was applied, and
 * the route answered 500.
 *
 * **The last assertion is an identity check, not a value check, and that is
 * deliberate.** `mergeDraft` builds `merged` as a fresh object literal whatever
 * the clone does, and `reconcileSecrets` then mutates `merged` rather than the
 * argument — so with the clone removed entirely, a value-based "the stored
 * draft is unchanged" assertion still passes. What distinguishes the two is
 * that `location` is carried into the result **by reference** when the patch
 * does not replace it: cloned, it is a new object; not cloned, it is the
 * caller's own.
 */
export function assertMergeDraftPatchesADeepStoredDraft(): void {
  const stored = {
    location: { name: "Deep site" },
    rtus: [{ code: "R1", displayName: "R1", protocol: "mqtt", config: deepConfig() }],
  };

  const merged = chatService().mergeDraft(stored, { rtus: [] }) as {
    rtus?: unknown[];
    location?: unknown;
  };

  assert(Array.isArray(merged.rtus), "the recovery patch must produce an rtus array");
  assert(merged.rtus?.length === 0, "the recovery patch must empty the rtus array");
  assert(
    stored.rtus.length === 1,
    "the stored draft's own rtus array must not have been emptied in place",
  );
  assert(
    merged.location !== stored.location,
    "the merge must carry a copy of the stored location, not the caller's own object",
  );
}
