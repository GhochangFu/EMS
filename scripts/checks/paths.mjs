// Path predicates shared by the Claude Code hooks (`.claude/hooks/`) and the
// git pre-commit hook (`.githooks/`).
//
// These live outside `.claude/` deliberately. Since the pre-commit hook is a
// non-Claude entry point into the same rules, a copy under `.claude/` would be
// a second definition of "which files does this rule apply to" — and the two
// copies would drift silently, each still passing its own tests. AGENTS.md
// records the same reasoning for ADR 0016's backoff table, which moved into
// `packages/shared` the moment it gained a second consumer.
//
// Every function here takes a path string and returns a boolean or a string.
// Nothing reads the filesystem, so both callers can test them directly.

import { sep } from 'node:path';

/** Normalise Windows separators so one regex serves both platforms. */
function norm(file) {
  return String(file || '').replace(/\\/g, '/');
}

/** A drizzle migration: `packages/db/drizzle/<name>.sql`, at any repo depth. */
export function isDrizzleMigration(file) {
  return /(^|\/)packages\/db\/drizzle\/[^/]+\.sql$/i.test(norm(file));
}

/**
 * The drizzle migrations directory for an edited path, or '' when unrelated.
 * Returned with native separators, because the caller joins onto it.
 *
 * Both callers' path shapes are handled on purpose: the Claude hook receives an
 * absolute path, while `git diff --cached --name-only` emits repo-relative ones
 * with no leading separator. An earlier version anchored on `/packages/…` and
 * would have returned '' for every staged path — the check would have passed
 * vacuously rather than failed, which is the worst way for a gate to break.
 */
export function drizzleDirFor(file) {
  const n = norm(file);
  const tail = 'packages/db/drizzle';
  const native = (s) => s.split('/').join(sep);

  if (n === tail || n.startsWith(`${tail}/`)) return native(tail);

  const idx = n.indexOf(`/${tail}/`);
  if (idx === -1) return '';
  return native(n.slice(0, idx + 1 + tail.length));
}

/** Any manifest we gate, excluding anything vendored under node_modules. */
export function isPackageJson(file) {
  const n = norm(file);
  return /(^|\/)package\.json$/.test(n) && !/(^|\/)node_modules\//.test(n);
}

/**
 * TypeScript source subject to the §4.1 / §4.5 style rules. Build output and
 * vendored code are excluded — the rules are about what we write.
 */
export function isStyleCheckedSource(file) {
  const n = norm(file);
  if (!/\.tsx?$/.test(n)) return false;
  return !/(^|\/)(node_modules|dist|build|coverage)\//.test(n);
}
