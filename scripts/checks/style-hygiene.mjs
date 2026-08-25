// AGENTS.md §4.1 / §4.5 style hygiene, shared by the Claude Code PostToolUse
// hook and the git pre-commit hook.
//
// Both callers check ADDED text only, never the whole file. Scanning a whole
// file would make every pre-existing `any` in a legacy module block every
// commit that touches it, which trains people to pass --no-verify — a gate
// everybody bypasses is worse than no gate at all.
//
// The line cap is the one whole-file rule, and it is deliberate: a file only
// crosses 1000 lines because of the edit in hand.

export const MAX_LINES = 1000;

/**
 * Best-effort removal of comments and string/template literals, so a match is
 * code rather than prose.
 *
 * This is what stops the word "any" in an explanatory comment from being read
 * as an `any` type — a false positive this repository has actually hit.
 */
export function stripNonCode(s) {
  return String(s || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, ' ')
    .replace(/"(?:\\.|[^"\\])*"/g, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, ' ');
}

/**
 * @param {string} addedText the newly written lines, not the whole file.
 * @returns {string[]} violations; empty means clean.
 */
export function styleViolations(addedText) {
  const raw = String(addedText || '');
  const code = stripNonCode(raw);
  const violations = [];

  if (/\bconsole\.(log|debug|info)\s*\(/.test(code)) {
    violations.push('console.log/debug/info - use the shared Pino logger (§4.5).');
  }
  if (/(:\s*any\b|\bas\s+any\b|<any>|\bany\[\]|Array<any>|Record<[^>]*\bany\b[^>]*>)/.test(code)) {
    violations.push('`any` type - use `unknown` and narrow (§4.1).');
  }
  // Checked against the raw text: an emoji inside a string literal is still an
  // emoji shipped in source.
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u.test(raw)) {
    violations.push('emoji in code - not allowed unless explicitly requested (§4.5).');
  }

  return violations;
}

/** @returns {string|null} a violation message when the file is over the cap. */
export function lineCapViolation(lineCount) {
  if (!Number.isFinite(lineCount) || lineCount <= MAX_LINES) return null;
  return `file is ${lineCount} lines - max ${MAX_LINES} lines per file this phase (§4.5).`;
}
