import { expect } from "vitest";

import { describeOnboardingUploadError } from "./onboarding-upload-error";

/**
 * `F4.106` — the onboarding upload's refusal sentence.
 *
 * Four claims in four exported functions. A shared function would stop at its
 * first failing `expect`, so a mutation reddening claim one would hide claims
 * two to four — the `F4.105` shape.
 *
 * The assertions are equalities. The plan asked for a second "leaks none of
 * `statusCode`, `Bad Request`, `{`" half on the envelope case, which is what an
 * assertion needs when its presence half is a *substring* match; `===` already
 * excludes every leak, so the extra half would be one no mutation can reach.
 */

/**
 * U1 — a 413 gets the 5 MB figure whatever its body is.
 *
 * The first body is multer's refusal read through Nest with an empty
 * passthrough. The second is the *other* topology: what a reverse proxy in
 * front of the API would answer `client_max_body_size` with, before the request
 * reaches the API at all. This repository ships no such proxy — its only nginx
 * serves static SPA files and does not proxy `/api` — so that body is a
 * deployment this branch has to survive rather than one the repo produces.
 * `oversizeUploadMessage` carries the evidence.
 */
export function aPayloadTooLargeAlwaysNamesTheLimit(): void {
  for (const body of ["", "<html><body>413 Request Entity Too Large</body></html>"]) {
    expect(describeOnboardingUploadError(413, body), `body ${JSON.stringify(body)}`).toBe(
      "File is too large — the limit is 5 MB.",
    );
  }
}

/** U2 — a Nest envelope renders the server's sentence and nothing around it. */
export function anEnvelopeRendersOnlyItsSentence(): void {
  expect(
    describeOnboardingUploadError(
      400,
      '{"message":"Workbook has no RTU sheet","error":"Bad Request","statusCode":400}',
    ),
  ).toBe("Workbook has no RTU sheet");
}

/**
 * U3 — a blank body still names the status.
 *
 * `apiErrorMessage("")` answers `The request failed.`, which is fine on a
 * screen that has other context and useless on one that has none. The status is
 * the only fact a blank refusal carries, so it is the one thing kept.
 */
export function aBlankBodyKeepsTheStatus(): void {
  expect(describeOnboardingUploadError(500, "")).toBe("Upload failed (500).");
  expect(describeOnboardingUploadError(502, "   ")).toBe("Upload failed (502).");
}

/**
 * U4 — an unrecognised body passes through unchanged.
 *
 * A gateway's HTML page is the only clue an unexpected failure leaves. Replacing
 * it with a generic line would make a screenshot undiagnosable, which is the
 * same argument `apiErrorMessage`'s own fallback rests on.
 */
export function anUnrecognisedBodyPassesThrough(): void {
  const page = "<html><body>504 Gateway Timeout</body></html>";
  expect(describeOnboardingUploadError(500, page)).toBe(page);
}
