import type { OnboardingChatMessage } from "@bms/shared";

/**
 * Credential detection for the onboarding chat (ADR 0022 decision 2, as
 * narrowed by Amendment 2).
 *
 * **This is a nudge, not the control.** The control is decision 1: credentials
 * arrive through `POST :id/credentials` and the wizard no longer asks for them
 * in chat. Three review rounds each found this predicate both missing real
 * shapes *and* damaging legitimate traffic, so Amendment 2 deliberately shrinks
 * it to high precision and accepts a wider miss set:
 *
 * - **A separator is always required** (`:`, `=`, or the word `is`). The earlier
 *   optional-separator form matched the product's own copy — "Add its
 *   credentials with the Credentials field" — and on the default rule-based
 *   path that deleted the one message telling users where the field is.
 * - **Every quantifier on a hot path is bounded, and the scan is capped twice.**
 *   Amendment 2 claimed this and did not deliver it: the value capture stayed
 *   `(\S+)` and fed a quadratic trim, and the `MAX_SCAN` slice ran *before*
 *   NFKC, which expands. Amendment 3 measured 110 ms (ASCII) and 3,083 ms (one
 *   expanding character, repeated) per turn from an input inside
 *   `chatBodySchema`'s own 8,000 cap — worse than the 74 ms it replaced. Node is
 *   single-threaded, so that is an API-wide stall per request.
 *
 * **Known misses, recorded rather than implied.** The list is wider than
 * Amendment 2 stated, because only `\s*` may sit between term and separator and
 * `\b` fails after any word character:
 *
 * - bare values ("hunter2") and separator-less keywords ("api key abc123");
 * - **any quoted or structured paste** — `{"password": "hunter2"}`, a `.conf`
 *   line, XML, and the wizard's own `**password**:` markdown convention;
 * - **camelCase and snake_case config keys** — `accessToken:`, `client_secret=`,
 *   `MQTT_PASSWORD=`, which is exactly the shape pasted out of a broker config;
 * - userinfo with no scheme ("user:pass@host").
 *
 * Closing these needs the detector to grow, which is what kept going wrong
 * across three review rounds. They are acceptable **only** because decision 1
 * gives credentials a typed home and the wizard no longer asks for them here.
 */

/**
 * Terms that name a secret. Every one requires an explicit separator, so
 * ordinary English containing these words is not refused.
 */
const SECRET_TERMS = [
  "pass(?:word|wd|phrase)?",
  "pwd",
  "pw",
  "creds?",
  "credentials?",
  "user(?:name)?",
  "login",
  "secret",
  "token",
  "community",
  "api[-_ ]?key",
  "auth[-_ ]?key",
  "priv(?:ate)?[-_ ]?key",
  "client[-_ ]?(?:key|cert(?:ificate)?)",
].join("|");

/**
 * Separator is mandatory — that single rule is what buys the precision.
 *
 * The captured value is bounded at 256. An unbounded `(\S+)` fed the trim in
 * `looksLikeCredential` a value as long as the whole scan, and that trim is
 * quadratic (see `VALUE_TRIM`). No real secret is 256 non-space characters
 * long, so the bound costs nothing and removes the amplifier.
 */
const TERM_PATTERN = new RegExp(
  `\\b(?:${SECRET_TERMS})\\b\\s*(?::|=|\\bis\\b)\\s*(\\S{1,256})`,
  "gi",
);

/**
 * Strips surrounding punctuation from a captured value.
 *
 * `[^\w/.@-]+$` backtracks over the whole run at every start index, so it is
 * O(n²) in the value's length. That is safe **only** because `TERM_PATTERN`
 * bounds the capture — the two must be changed together.
 */
const VALUE_TRIM = /^[^\w/.@-]+|[^\w/.@-]+$/g;

/**
 * URI userinfo — `scheme://user:secret@host`. Every quantifier is bounded, and
 * `looksLikeCredential` only runs this after a literal `://` substring test, so
 * the common case costs one `indexOf`.
 */
const URI_USERINFO = /[a-z][a-z0-9+.-]{0,31}:\/\/[^/\s:@]{1,128}:[^/\s@]{1,256}@/i;

/** `Authorization: Basic dXNlcjpwYXNz` / `Bearer eyJ…` */
const HTTP_AUTH = /\b(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]{8,512}\b/i;

/** Zero-width, soft hyphen and bidi characters used to break up a keyword. */
const INVISIBLE = /[­͏​-‏⁠-⁯︀-️﻿]/g;

/** Cyrillic and Greek letters that render as Latin ones. */
const HOMOGLYPHS: Record<string, string> = {
  "а": "a",
  "е": "e",
  "о": "o",
  "р": "p",
  "с": "c",
  "у": "y",
  "х": "x",
  "ѕ": "s",
  "і": "i",
  "ј": "j",
  "ԁ": "d",
  "ο": "o",
  "α": "a",
  "ϲ": "c",
};

/**
 * Longest input scanned. `chatBodySchema` already caps a turn at 8,000, but
 * stored transcripts are unbounded and `scrubMessages` walks all of them on
 * every read — so the cap is enforced here rather than trusted upstream.
 */
const MAX_SCAN = 8_000;

/**
 * Slice, normalise, **then slice again**. NFKC expands: `U+3316` (㌖) becomes
 * six characters with no whitespace, so 7,912 input characters — inside
 * `chatBodySchema`'s own cap — normalised to 47,412 and the "cap" bounded
 * nothing. The first slice bounds the work `normalize` itself does on an
 * unbounded stored transcript; the second bounds what expansion produced.
 */
function normalise(value: string): string {
  return value
    .slice(0, MAX_SCAN)
    .normalize("NFKC")
    .slice(0, MAX_SCAN)
    .replace(INVISIBLE, "")
    .replace(/[Ѐ-ԯͰ-Ͽ]/g, (ch) => HOMOGLYPHS[ch] ?? ch);
}

/**
 * Words that may follow a separator without being a value, so "credentials are
 * encrypted before storage" is not refused.
 */
const NON_VALUES = new Set(["yet", "now", "later", "encrypted", "required", "set", "optional"]);

/** True when a chat turn appears to carry a secret and should be refused. */
export function looksLikeCredential(message: unknown): boolean {
  if (typeof message !== "string" || message.length === 0) {
    return false;
  }
  const text = normalise(message);

  // Cheap literal guard before either bounded shape regex runs.
  if (text.includes("://") && URI_USERINFO.test(text)) {
    return true;
  }
  if (HTTP_AUTH.test(text)) {
    return true;
  }

  const termOnly = new RegExp(`^(?:${SECRET_TERMS})$`, "i");
  TERM_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(TERM_PATTERN)) {
    const value = (match[1] ?? "").replace(VALUE_TRIM, "").toLowerCase();
    if (!value || NON_VALUES.has(value) || termOnly.test(value)) {
      continue;
    }
    return true;
  }
  return false;
}

/** Replacement text for a turn withheld from the client. */
// Deliberately contains no secret term followed by a separator, so it does not
// match itself — an earlier marker did, which is how broad that version was.
const REDACTED = "[REDACTED] — withheld by ADR 0022";

/**
 * Defence in depth (ADR 0022 decision 4): scrub stored turns on the way out.
 *
 * It shares `looksLikeCredential`, so its miss set is the same by construction —
 * stated plainly rather than implied, because Amendment 1 claimed more than the
 * code delivered.
 */
export function scrubMessages(messages: unknown): OnboardingChatMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return { role: "user", content: REDACTED } as OnboardingChatMessage;
    }
    const row = entry as Partial<OnboardingChatMessage>;
    if (typeof row.content !== "string") {
      return { ...(row as OnboardingChatMessage), content: REDACTED };
    }
    return {
      ...(row as OnboardingChatMessage),
      content: looksLikeCredential(row.content) ? REDACTED : row.content,
    };
  });
}
