import { apiErrorMessage } from "../lib/api-error-message";

/**
 * What the server said when *Evaluate now* was refused (`F3.47`).
 *
 * ## Why this is a component and not three lines inside the panel
 *
 * `rules-panel.tsx` is large — reaching any of its markup costs a whole panel
 * render with the rules, execution, catalog and vocabulary queries all stubbed.
 * (No line count here on purpose: the one this used to carry went stale in the
 * same commit that corrected the sentence around it, and any comment edit in
 * that file would stale it again.) Two tests in
 * `rule-channels-editor.spec.tsx` pay that price, and one
 * of them — `showsTheEvaluateRefusalWhereTheOperatorPressed` — was written for
 * this component, so inline this markup would be reachable, at that price, from
 * exactly one place. Extracted it is presentational, takes one prop, and
 * carries three assertions that need no panel at all.
 *
 * Those three prove the component and **not** that anything renders it: this
 * had one call site, and deleting it left every suite green. That is the gap
 * `showsTheEvaluateRefusalWhereTheOperatorPressed` closes, and it is why that
 * test renders the panel rather than the notice. Move the call site and it is
 * what fails.
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
