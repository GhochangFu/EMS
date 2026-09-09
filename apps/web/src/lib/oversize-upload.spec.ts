import { expect } from "vitest";

import { oversizeUploadMessage } from "./oversize-upload";

/**
 * `F4.106` — the shared oversize-upload sentence.
 *
 * Two claims, in two exported functions, because the `expect` in the first
 * would stop the second from ever running.
 */

/**
 * O1 — the sentence, character for character.
 *
 * It is pinned exactly rather than by a substring because two existing
 * assertions in `telemetry-import-preview.spec.ts` compare against this literal
 * and would break silently if the extraction had reworded it.
 */
export function aPayloadTooLargeGetsTheFiveMegabyteSentence(): void {
  expect(oversizeUploadMessage(413)).toBe("File is too large — the limit is 5 MB.");
}

/**
 * O2 — every other status keeps its caller's own wording.
 *
 * `null` and not a generic line: each caller has a different fallback
 * (`Import failed (…)`, `Mapping sheet upload failed (…)`, `Upload failed (…)`),
 * and ruling 2 kept those deliberately. 200 is here because a helper that
 * answered on a success would be a live bug at any call site that asked first.
 */
export function everyOtherStatusIsNull(): void {
  for (const status of [200, 400, 401, 403, 412, 414, 500]) {
    expect(oversizeUploadMessage(status), `status ${status}`).toBeNull();
  }
}
