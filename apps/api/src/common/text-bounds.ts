/**
 * String bounds shared by every module that cuts text before it is stored or
 * sent to a model (`F3.85`, ADR 0099). `cutToBound` moved here from
 * `admin/onboarding/onboarding-draft-caps.ts`, which re-exports it, so the
 * generic LLM core under `llm/` reads it without importing onboarding.
 */

/** The UTF-16 range a **high** surrogate occupies; a code unit here is half of a pair. */
const HIGH_SURROGATE_FIRST = 0xd800;
const HIGH_SURROGATE_LAST = 0xdbff;

/**
 * `value` cut to at most `max` characters, **never through the middle of a
 * character** — the only cut the rule-based chat branch is allowed to make.
 *
 * **Why a bare `.slice(0, max)` is wrong, and how it fails.**
 * `String.prototype.slice` counts UTF-16 code units, and every character outside
 * the Basic Multilingual Plane — an emoji, most CJK extension B ideographs, a
 * mathematical alphanumeric — occupies two of them. A cut that lands between the
 * two leaves a **lone high surrogate**, which is not a character at all, and the
 * draft is written to a `jsonb` column: `JSON.stringify` escapes the orphan as
 * `\ud83d` (ES2019 well-formed stringify), and Postgres refuses that input with
 * `invalid input syntax for type json — Unicode low surrogate must follow a high
 * surrogate`. A chat message of 200 emoji is 400 code units, so `.slice(0, 255)`
 * splits the 128th pair and the turn answers **500**, repeatably, from a body no
 * schema refuses.
 *
 * **Why this cuts on code units and then strips, rather than on code points.**
 * `[...value].slice(0, max).join("")` is the form that first suggests itself and
 * it is *not* interchangeable with this one: it keeps `max` code **points**,
 * which is up to `2 × max` code units, and `z.string().max()` measures
 * `String.length` — code units. The 200-emoji message above comes back at 400
 * characters, `onboardingDraftSchema` refuses `location.name`, and
 * `OnboardingValidateService.validate` hands the operator the permanent
 * per-field error this whole slice exists to prevent. Cutting to `max` code
 * units satisfies the schema, and satisfies the `varchar` column a fortiori,
 * because a string of `max` code units is at most `max` characters.
 *
 * **What this does not promise.** It makes the cut no worse than its input; it
 * does not make an arbitrary string safe for `jsonb`. A lone *low* surrogate
 * that arrived in the request body — `JSON.parse` accepts the `\udc00` escape
 * and `chatBodySchema` has no well-formedness check — passes through untouched
 * and still fails the write. That is older than this function and is recorded as
 * a residual on `packages/shared/src/contracts/onboarding.ts`; do not read this
 * docblock as saying it is closed.
 */
export function cutToBound(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  const cut = value.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= HIGH_SURROGATE_FIRST && last <= HIGH_SURROGATE_LAST ? cut.slice(0, -1) : cut;
}
