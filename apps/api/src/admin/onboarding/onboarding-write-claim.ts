/**
 * `F4.339` (ADR 0117 decision 2, plan R2) — the onboarding agent's write-claim
 * guard. Pure; no I/O.
 *
 * The BCPL onboarding of 2026-11-08 saw replies written in the shape of the
 * code's own action lines ("Mapped 'k' → 'pk' on asset 'a'") in turns that
 * called no tool: the reply said the draft changed and nothing was stored.
 * The turn persists action rows and the reply in one locked write, so a reply
 * that claims a write while the turn's draft did not change is false by
 * construction.
 *
 * Two layers, the copilot's `cardRetryFor` / `withNoChangeNote` pattern:
 * - `writeClaimRetryFor` — the loop's `correctFinal`: the claim goes back to
 *   the model once, in the same turn, inside the same caps;
 * - `withoutWriteClaims` — when the reply still claims and nothing was
 *   written, the claim lines and sentences are dropped and a fixed line leads.
 *
 * A negated sentence ("Nothing was written", "Not applied", "could not") is
 * never a claim, so the fixed line never tags itself.
 */

/** The code-written action-line shapes, matched at the start of a line (bullets and `**` stripped). */
const LINE_CLAIM = /^(?:Added|Mapped|Updated|Removed|Set location|Proposed (?:commit|discovery)|Imported|Cleared|Declared|Point keys:)(?:\b|\s)/;

/** Claims in prose, matched per sentence. */
const SENTENCE_CLAIMS: readonly RegExp[] = [
  /\b(?:I|I've|I have|we've|we have)\s+(?:now\s+)?(?:added|mapped|updated|removed|set|cleared|imported|declared|proposed)\b/i,
  /\b(?:is|are|has been|have been)\s+(?:now\s+)?(?:added|mapped|written|stored|saved|updated|removed)\s+(?:to|in|on)\s+the draft\b/i,
];

/** The copilot's negation rule (`copilot-card-claim.ts`), per sentence. */
const NEGATION = /\b(?:no|not|nothing|never)\b/i;

/**
 * A line-shape claim is negated only by its first words ("Added nothing"):
 * a code-written line may itself carry "not" in its tail ("(type not set)",
 * a config-only note), and it is still a write.
 */
const LINE_NEGATION = /^(?:\S+\s+){1,2}(?:nothing|no|not|never)\b/i;

/** Every claim pattern, for the spec's table. */
export const WRITE_CLAIM_PATTERNS: readonly RegExp[] = [LINE_CLAIM, ...SENTENCE_CLAIMS];

/** The fixed line that leads a reply whose write claims were dropped. */
export const NOTHING_WRITTEN_LINE = "Nothing was written in this turn.";

/** The correction's fixed body; the hinted tool follows the last sentence's `<tool>`. */
export const ONBOARDING_WRITE_CLAIM_RETRY_MESSAGE =
  "[Server check — data, not a request from the user.] Your reply says the draft was changed, but no tool wrote to the draft in this turn, so nothing was stored. If the user's own message asked for this change, call <tool> now. Otherwise answer again and say that nothing was written.";

/** A line's text without a list bullet, a numbering or leading bold markers. */
function bare(line: string): string {
  return line
    .trim()
    .replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, "")
    .replace(/^\*\*/, "")
    .trim();
}

/** Negation is read outside quoted names, so an asset coded 'NO-1' does not negate a line. */
function negated(text: string): boolean {
  return NEGATION.test(text.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, ""));
}

function lineClaims(line: string): boolean {
  const text = bare(line);
  return LINE_CLAIM.test(text) && !LINE_NEGATION.test(text);
}

function sentencesOf(line: string): string[] {
  return line.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.trim() !== "");
}

function sentenceClaims(sentence: string): boolean {
  return !negated(sentence) && SENTENCE_CLAIMS.some((pattern) => pattern.test(sentence));
}

/** True when a line of the reply has an action-line shape, or a sentence says the draft was changed, without a negation. */
export function claimsAWrite(reply: string): boolean {
  return reply.split("\n").some((line) => lineClaims(line) || sentencesOf(line).some(sentenceClaims));
}

/** The fixed verb → tool table (plan R2); the first matching line names the tool. */
const TOOL_HINTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^Added asset\b/, "add_asset"],
  [/^Added \d+ assets\b/, "add_template_assets"],
  [/^Added RTU\b/, "add_rtu"],
  [/^Added (?:\d+ )?point keys?\b/, "add_point_key or add_point_keys"],
  [/^Mapped\b/, "map_point or map_points"],
  [/^Updated RTU\b/, "update_rtu"],
  [/^Removed RTU\b/, "remove_rtu"],
  [/^Set location\b/, "set_location"],
  [/^Proposed commit\b/, "propose_commit"],
  [/^Proposed discovery\b/, "propose_discovery"],
];

function hintedTool(reply: string): string {
  for (const line of reply.split("\n")) {
    if (!lineClaims(line)) continue;
    const text = bare(line);
    const hit = TOOL_HINTS.find(([pattern]) => pattern.test(text));
    if (hit) return hit[1];
  }
  return "the matching tool";
}

/** The correction for a final text that claims a write in a turn that wrote nothing; `null` when the turn wrote or nothing is claimed. */
export function writeClaimRetryFor(reply: string, wrote: boolean): string | null {
  if (wrote || !claimsAWrite(reply)) return null;
  return ONBOARDING_WRITE_CLAIM_RETRY_MESSAGE.replace("<tool>", hintedTool(reply));
}

/** The reply with every claim line and claim sentence dropped, led by {@link NOTHING_WRITTEN_LINE}. */
export function withoutWriteClaims(reply: string): string {
  const kept: string[] = [];
  for (const line of reply.split("\n")) {
    if (lineClaims(line)) continue;
    const sentences = sentencesOf(line);
    const rest = sentences.filter((sentence) => !sentenceClaims(sentence));
    if (rest.length === sentences.length) {
      kept.push(line);
    } else if (rest.length > 0) {
      kept.push(rest.join(" "));
    }
  }
  const rest = kept.join("\n").trim();
  return rest === "" ? NOTHING_WRITTEN_LINE : `${NOTHING_WRITTEN_LINE}\n${rest}`;
}
