import { apiErrorMessage } from "../lib/api-error-message";

/**
 * What the server said when *Evaluate now* was refused (`F3.47`).
 *
 * ## Why this is a component and not three lines inside the panel
 *
 * `rules-panel.tsx` is 498 lines and is rendered by two tests, neither written
 * for this. Inline, this markup would be reachable by nothing — the reason §4.3
 * gives for pulling a `*.serialise.ts` out of a service. Here it is
 * presentational, takes one prop, and has three assertions on it.
 *
 * Those three prove the component and **not** that anything renders it: this
 * had one call site, and deleting it left every suite green. The wiring is
 * asserted through the panel itself, by
 * `showsTheEvaluateRefusalWhereTheOperatorPressed` in
 * `rule-channels-editor.spec.tsx`. Move the call site and that is what fails.
 *
 * ## Why `apiErrorMessage` and not `String(error)`
 *
 * `evaluateRules` throws `new Error(text)` with the **whole** response body, so
 * `String(error)` would render `{"statusCode":429,"message":"…"}` at an
 * operator — the exact defect `api-error-message.ts` records from `F2.5`, where
 * the service wrote a good sentence and nobody ever saw it.
 *
 * The seconds to wait are in that sentence and nowhere else the SPA can read:
 * the API sets `Retry-After`, but deliberately does not expose it across the
 * origin, so a UI reading the header would render `null`.
 */
export function EvaluateRefusalNotice({ error }: { error: unknown }) {
  if (!error) {
    return null;
  }
  return (
    <p role="alert" className="px-4 pt-2 text-xs text-red-600">
      {apiErrorMessage(error)}
    </p>
  );
}
