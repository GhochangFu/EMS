// AGENTS.md §9.4 / §4: adding or changing a dependency requires an ADR.
//
// Shared by `.claude/hooks/check-dependency-adr.mjs` (which sees the text an
// agent is about to write) and `.githooks/pre-commit.mjs` (which sees the
// staged diff). The regex below IS the check — a second copy of it could be
// weakened on one path while the other still passed, and nothing would report
// the difference. That is why it lives here and not in either caller.

/**
 * A JSON line shaped like `"<name>": "<version-or-source-spec>"`.
 *
 * The alternation is what keeps a script entry out: `"db:seed": "pnpm ..."`
 * does not start with a version token, so it is not a dependency. Note that
 * `git+` requires the plus — a value beginning `git config ...` is a script,
 * not a git dependency, and must not match.
 */
export const SPEC =
  /"[^"]+"\s*:\s*"(?:\^|~|>=|<=|>|<|\d|\*|workspace:|npm:|file:|link:|git\+|https?:|github:)/;

/** Every line of `text` that looks like a dependency specifier. */
export function specLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => SPEC.test(l));
}

/**
 * Specifier lines present in `after` but not in `before`.
 *
 * Set-based rather than positional, so reordering a manifest reports nothing.
 */
export function addedSpecLines(before, after) {
  const seen = new Set(specLines(before));
  return specLines(after).filter((l) => !seen.has(l));
}
