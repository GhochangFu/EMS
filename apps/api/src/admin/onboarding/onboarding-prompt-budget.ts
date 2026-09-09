/**
 * The size bound on the draft context `handleOpenAiTurn` embeds in its system
 * prompt, and the two shed passes that enforce it.
 *
 * **Nothing measured the serialised draft before this module** (`F4.107`).
 * `F4.103` caps how many items a draft holds, `F4.104` how long one string may
 * be, `F4.115` how deep it may nest; the ~0.65 MB a turn can forward is a
 * *consequence* of those three limits meeting a 102,400-byte body limit, not a
 * check anything performs. The whole redacted draft was serialised into the
 * prompt on every turn.
 *
 * Its own module rather than a third responsibility for
 * `onboarding-redaction.ts`, on the `onboarding-draft-caps.ts` precedent: the
 * number, its derivation and the sentence that explains it live together.
 *
 * `serialiseDraftForPrompt` returns the JSON **text**, and the type is honest
 * about why. The budget is measured on serialised bytes, so the function has to
 * `stringify` to decide, and a shed draft is not an `OnboardingDraft` any more —
 * `rtus[].config` is a `string` where the type says `Record<string, unknown>`.
 * Returning `OnboardingDraft` would need a cast that lies at exactly the field
 * this row is about.
 */

import { redactDraftForLlm } from "./onboarding-redaction";
import { MAX_ONBOARDING_DRAFT_DEPTH } from "./onboarding.schema";
import { exceedsDepth, isJsonContainer, rebuildDeep } from "../stack-safe-json";

/**
 * The serialised size above which the draft is shed before it is forwarded.
 *
 * **Measured, not estimated.** Every figure below is
 * `Buffer.byteLength(JSON.stringify(redactDraftForLlm(draft)))` on a draft built
 * through the shipped producers — `OnboardingExcelService.parseUpload` and
 * `toDraftPatch` on a generated workbook — on node v24.17.0. Byte counts do not
 * move with the runtime.
 *
 * - *Floor — 82,280 B (80.4 KiB).* The demo estate at the seed's scale, every
 *   array populated with realistic strings: 10 RTUs, 99 assets, 40 point keys,
 *   495 asset points. The shipped template an operator is handed is 981 B, and
 *   an at-caps workbook upload with realistic cells (100 RTUs, 500 assets) is
 *   76,846 B. A session that never touches this bound is the ordinary case.
 * - *Bound — 262,144 B (256 KiB).* 3.19× the floor, and 2.56× one 102,400-byte
 *   request body, which is the largest single write any producer makes. So an
 *   at-caps upload with realistic cells plus one whole body of mappings — about
 *   180 KB — still forwards whole.
 * - *Ceilings, for contrast, and both are per turn.* **651,960 B** is the
 *   producer-reachable maximum, and it is the measured total rather than the sum
 *   of the parts below: an at-caps upload with every cell at its column width
 *   (448,100 B) plus one 102,400-byte body of max-width point keys and one of
 *   max-width asset points. 40 point keys fit one body and 238 asset points do —
 *   239 when the `assetIndex` stays a single digit, which is the count the plan
 *   records; one of each costs 2,539 B and 427 B at a one-digit index and a
 *   little more as the index grows. The bound sits 2.49× below the total. The
 *   other ceiling is the model's context window — 128k
 *   tokens for the default `gpt-4o-mini`, roughly 350–450 KB of JSON, a property
 *   of `OPENAI_MODEL` that nothing asserts — above which OpenAI refuses the
 *   request and the bare `catch {}` at `onboarding-chat.service.ts` degrades the
 *   turn to rule-based silently. Worth stating plainly: a draft at 651,960 B
 *   cannot reach the model at all today, so on such a draft the shed does not
 *   only bound the forward, it is what makes the LLM turn answer.
 *
 * **128 KiB was considered and declined.** It would buy 128 KiB per turn less
 * secret-scrubbed opaque data forwarded unshed, and roughly 35k fewer tokens at
 * the worst under-budget case. It would cost a legitimate estate between about
 * 130 KB and 250 KB — an at-caps realistic upload plus one body of mappings is
 * about 180 KB — its `config` (host, port, topic) in the `rtu` phase, which is a
 * functional loss with no security gain, because `config` is already
 * secret-scrubbed by the time it arrives here. Under a per-turn ceiling of
 * 651,960 B either number is a real bound; 256 KiB is the one that does not shed
 * a legitimate estate.
 *
 * **It is a shedding threshold, not a hard limit** — see
 * `serialiseDraftForPrompt`.
 */
export const PROMPT_DRAFT_BUDGET_BYTES = 262_144;

/**
 * The length above which a string is opaque enough to shed — the widest
 * code/name column in `ONBOARDING_DRAFT_STRING_MAX`.
 *
 * Ruling 2 keeps every code, name and protocol. Six columns are 255 characters
 * wide (`location.name`, `rtus.displayName`, `rtus.stationName`, `assets.name`,
 * `assets.siteName`, `pointKeys.name`) and every other column is narrower, so at
 * 255 stage 2 can take nothing the ruling protects. Exactly one column is wider:
 * `pointKeys.description` at 2,000, which decision 4 rules opaque operator prose
 * — not a code, not a name, not a protocol.
 *
 * **Pinned by an assertion, not derived by filtering the record.** Derived, a
 * column widened later would raise this threshold with it and stage 2 would
 * quietly stop shedding; pinned, that edit reddens
 * `assertPromptStringMaxIsTheWidestNameColumn` and someone decides.
 *
 * Counted in UTF-16 code units, which is what `.max()` counts (`F4.104`) — while
 * the budget above is counted in bytes, which is what the prompt costs. The two
 * units are deliberate and each is measured where it is spent.
 */
export const PROMPT_STRING_MAX = 255;

/**
 * What a shed value is replaced by. A fixed literal, and §4.3 is the reason:
 * it names no key, states no size and carries no fragment of the value it
 * replaced. `assertTheMarkerEchoesNothing` pins that two drafts differing only
 * in a shed value's content and size forward byte-identical text.
 *
 * 29 characters, 31 bytes once JSON has quoted it.
 */
export const PROMPT_OMITTED_MARKER = "[omitted: over prompt budget]";

/**
 * Stage 1 — every `config` and `meta` becomes the marker, at any depth.
 *
 * The four free-form records (`rtus[].config`, `rtus[].meta`, `assets[].meta`,
 * `location.meta`) are the draft's only `z.record(z.unknown())` fields, so they
 * are the only ones holding data no schema in this repository can describe.
 * Ruling 2 sheds those first.
 *
 * A **key** visitor is enough here, and that is what makes the depth pre-check
 * in `serialiseDraftForPrompt` sufficient: the visitor answers before the value
 * under the key is read, so a 20,000-deep `config` is replaced without ever
 * being descended into.
 *
 * On a schema-shaped draft those two key names are exactly the four fields —
 * `onboardingMeta` is a different name, and no other `config` key exists. On
 * anything else the visitor sheds more, never less, which is the safe direction
 * under §4.3.
 *
 * Whole-stage rather than per-value (decision 3): shedding only as much as the
 * budget needs would show the model RTU-1's config and not RTU-2's depending on
 * key order, which is arbitrary and unexplainable to an operator reading the
 * assistant's reply.
 */
export function shedFreeFormRecords(value: unknown): unknown {
  return rebuildDeep(value, isJsonContainer, (key) =>
    key === "config" || key === "meta" ? { value: PROMPT_OMITTED_MARKER } : null,
  );
}

/**
 * Stage 2 — every string wider than any code or name column becomes the marker.
 *
 * This one decides on a **value**, which a key visitor cannot see, so it is the
 * `LeafVisitor` `F4.107` added to `rebuildDeep`. Not a fourth traversal: §4.8,
 * and `tests/f4.115-iterative-draft-walkers.test.ts` gates it.
 *
 * `>` and not `>=`: a string exactly at a column's width is that column's
 * legitimate value, and six columns are exactly `PROMPT_STRING_MAX` wide.
 *
 * Iterative, like every other walk over a stored draft, and it has its own
 * assertion for it: `assertADeepStoredDraftIsShedNotThrownOutOf` never reaches
 * this pass, because stage 1 removes the depth before any string is looked at.
 */
export function shedOverLongStrings(value: unknown): unknown {
  return rebuildDeep(value, isJsonContainer, undefined, (leaf) =>
    typeof leaf === "string" && leaf.length > PROMPT_STRING_MAX
      ? { value: PROMPT_OMITTED_MARKER }
      : null,
  );
}

/**
 * The redacted draft as prompt text, shed until it fits the budget or until
 * nothing is left to shed.
 *
 * Order, and why depth comes before the ruler:
 *
 * 1. `redactDraftForLlm` — already iterative, so a deep stored draft survives it.
 * 2. If it nests past `MAX_ONBOARDING_DRAFT_DEPTH`, shed the records **before**
 *    the first `stringify`. `JSON.stringify` is recursive and throws a
 *    `RangeError` somewhere above four thousand levels; inside
 *    `handleOpenAiTurn`'s `try` that error is swallowed by a bare `catch {}` and
 *    the turn degrades to rule-based with no log line. So the measurement itself
 *    is what fails on the draft that most needs measuring. A budget you cannot
 *    measure on the input is not a budget.
 * 3. Serialise. Under the budget, forward it whole — that is the ordinary
 *    session, and `assertAnUnderBudgetDraftIsForwardedIntact` is the half of the
 *    pair that says the shed does not fire when it should not.
 * 4. Over: stage 1, then measure again.
 * 5. Still over: stage 2, and return what that produces.
 *
 * Three `stringify` calls of at most ~0.65 MB is milliseconds, and only on a
 * draft already over the budget.
 *
 * **The budget is a shedding threshold, not a hard limit** (decision 1, the
 * owner's ruling: option a). What survives both stages is codes, names and
 * protocols, and the rulings shed none of it, so the returned text may still be
 * over budget — 651,960 B at the caps with max-width cells, about 282 KB with
 * realistic ones plus two bodies of mappings. It is returned anyway: valid,
 * untruncated, every item present, and
 * `assertAResidualOverBudgetPayloadIsValidJson` pins that it neither throws nor
 * cuts. What that leaves open, stated rather than implied: **a hostile draft of
 * 255-character names still forwards in full**, because 600 such `displayName`s
 * are names the model reasons about by the ruling's letter.
 *
 * The two declined alternatives: returning `null` to take the rule-based branch
 * is a hard cap, but it removes a working LLM turn for every estate between the
 * budget and the model's context window; a third stage shedding array items
 * contradicts ruling 2, which keeps every code and name.
 */
export function serialiseDraftForPrompt(draft: unknown): string {
  let redacted: unknown = redactDraftForLlm(draft);

  if (exceedsDepth(redacted, MAX_ONBOARDING_DRAFT_DEPTH)) {
    redacted = shedFreeFormRecords(redacted);
  }

  let json = JSON.stringify(redacted);
  if (Buffer.byteLength(json) <= PROMPT_DRAFT_BUDGET_BYTES) {
    return json;
  }

  redacted = shedFreeFormRecords(redacted);
  json = JSON.stringify(redacted);
  if (Buffer.byteLength(json) <= PROMPT_DRAFT_BUDGET_BYTES) {
    return json;
  }

  return JSON.stringify(shedOverLongStrings(redacted));
}
