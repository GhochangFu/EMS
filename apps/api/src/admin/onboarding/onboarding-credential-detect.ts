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
 * - **Quantifiers are bounded and there is a cheap pre-filter.** The earlier
 *   unbounded `[a-z0-9+.-]*` was quadratic: 74 ms per turn at `chatBodySchema`'s
 *   8,000-char maximum, and ~15.7 s per session read over a 100-turn transcript
 *   via `scrubMessages`. Node is single-threaded, so that was an API-wide DoS.
 *
 * **Known misses, recorded rather than implied:** a bare value ("hunter2"), a
 * keyword with no separator ("api key abc123"), userinfo with no scheme
 * ("user:pass@host"), and `MQTT_PASSWORD=x` where a leading underscore defeats
 * the word boundary. Closing these needs the detector to grow, which is what
 * kept going wrong. They are acceptable because decision 1 exists.
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

/** Separator is mandatory — that single rule is what buys the precision. */
const TERM_PATTERN = new RegExp(
  `\\b(?:${SECRET_TERMS})\\b\\s*(?::|=|\\bis\\b)\\s*(\\S+)`,
  "gi",
);

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

function normalise(value: string): string {
  return value
    .slice(0, MAX_SCAN)
    .normalize("NFKC")
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
    const value = (match[1] ?? "").replace(/^[^\w/.@-]+|[^\w/.@-]+$/g, "").toLowerCase();
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
