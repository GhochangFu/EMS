import { apiErrorMessage } from "./api-error-message";
import { oversizeUploadMessage } from "./oversize-upload";

/**
 * Turns a refused onboarding Excel upload into a sentence (`F4.106`).
 *
 * `uploadOnboardingExcel` threw `new Error(text || …)` — the whole response
 * body, raw. The wizard then rendered it, so an operator uploading a 6 MB
 * workbook read `{"message":"File too large","error":"Payload Too Large",
 * "statusCode":413}` and was told nothing about what would fit.
 *
 * ## The order, and why each step has to be where it is
 *
 * 1. `oversizeUploadMessage` first, so a 413 gets the 5 MB figure whatever its
 *    body is — Nest's envelope, and the HTML page an externally supplied
 *    reverse proxy would answer with. That second topology is named rather than
 *    assumed in `oversizeUploadMessage`; this repository ships no proxy in
 *    front of the API.
 * 2. An empty body next, because `apiErrorMessage("")` answers
 *    `The request failed.`, which loses the status. `Upload failed (500).`
 *    keeps the one fact a blank refusal carries.
 * 3. Everything else through `apiErrorMessage`, which is the repository's one
 *    unwrapper (§4.8) and — since `F4.106` — also handles the Zod `flatten()`
 *    the onboarding routes throw. Passing it a raw string rather than an
 *    `Error` is supported and asserted in its own spec.
 *
 * ## Why it lives in `lib/` and not beside `uploadOnboardingExcel`
 *
 * The same reason `api-error.ts` gives: the coverage `include` reaches
 * `apps/web/src/lib/**` and stops there, and `api/admin/onboarding.ts` reads
 * `import.meta.env` at module scope.
 *
 * The wording of the blank-body fallback gains a full stop the original line
 * did not have, so it matches `Import failed (…).` and
 * `Mapping sheet upload failed (…).` — the two sibling helpers.
 *
 * §9.6: this text is rendered, never logged. `bodyText` is server output of
 * unknown content — no claim is made here about what any particular route puts
 * in it, which is the reason not to log it.
 *
 * @param status the HTTP status of the refused upload.
 * @param bodyText the response body, verbatim.
 */
export function describeOnboardingUploadError(status: number, bodyText: string): string {
  const oversize = oversizeUploadMessage(status);
  if (oversize !== null) {
    return oversize;
  }
  if (bodyText.trim() === "") {
    return `Upload failed (${status}).`;
  }
  return apiErrorMessage(bodyText);
}
