/**
 * The `{token}` grammar of `bms.template_points.source_data_key_pattern`
 * (`F2.7`, ADR 0056 decision 10 — "one vocabulary, wired twice").
 *
 * Pure, zod-free. Declared once here because two consumers read the same
 * grammar and must agree to the character: `apps/api`'s instantiate service
 * substitutes a pattern into an `asset_points.source_data_key`, and the mapping
 * sheet's pre-fill (and the instantiate dialog, `F4.56`) scan the same patterns
 * for the variables a person must supply. Before this module the regex and the
 * reserved variable lived as private constants of the instantiate service, so
 * a second reader would have had to copy them — the "copied enum that drifts"
 * AGENTS.md §4.8 names.
 *
 * `index.ts` re-exports this module, so `apps/api` (node10 module resolution,
 * which ignores the `exports` map) reaches it through the barrel.
 */

/**
 * `{token}` in a `source_data_key_pattern`: braces around `[a-zA-Z0-9_]+`.
 * Global, so `matchAll` accepts it; every function here either clones it
 * (`matchAll`) or resets it (`replace`), so `lastIndex` never leaks between
 * calls.
 */
export const SOURCE_KEY_PATTERN_TOKEN = /\{([a-zA-Z0-9_]+)\}/g;

/**
 * Always substituted from the asset's own `code`, never from a caller's
 * variables. Letting a caller override it would let two assets in one batch
 * resolve to the same `source_data_key` while carrying different codes —
 * silently aliasing two pieces of equipment onto one telemetry stream.
 */
export const SOURCE_KEY_RESERVED_VAR = "asset_code";

/** What one substitution produced: the key, and the tokens it could not fill. */
export type SourceKeySubstitution = {
  /** The pattern with every known token replaced; unknown tokens stay literal. */
  readonly key: string;
  /** Distinct unresolved token names, in first-appearance order. */
  readonly unresolved: string[];
};

/** The distinct `{token}` names of one pattern, in first-appearance order. */
export function patternTokens(pattern: string): string[] {
  const seen = new Set<string>();
  for (const match of pattern.matchAll(SOURCE_KEY_PATTERN_TOKEN)) {
    seen.add(match[1] as string);
  }
  return [...seen];
}

/**
 * The distinct variables a set of patterns asks a person for: every token
 * across `patterns`, minus the reserved `asset_code`, in first-appearance
 * order. A `null`/`undefined` pattern (a point with none) is skipped.
 */
export function patternVariables(patterns: ReadonlyArray<string | null | undefined>): string[] {
  const seen = new Set<string>();
  for (const pattern of patterns) {
    if (!pattern) {
      continue;
    }
    for (const token of patternTokens(pattern)) {
      if (token !== SOURCE_KEY_RESERVED_VAR) {
        seen.add(token);
      }
    }
  }
  return [...seen];
}

/**
 * Substitutes `{token}`s from `vars`. A known token is replaced; an unknown one
 * is left **literal** and reported by name, so the caller decides what that
 * means — the instantiate service refuses the key (`null`), the mapping sheet's
 * pre-fill ships `CH{unit}_T` for the person to finish.
 *
 * `vars` is read with `Object.prototype.hasOwnProperty.call`, never by
 * property access. A plain object literal resolves inherited members, so a
 * pattern containing `{constructor}` or `{toString}` would otherwise find a
 * function, skip the unresolved branch, and stringify it into a
 * `source_data_key` — the guard the instantiate service carried, kept here.
 */
export function substituteSourceKeyPattern(
  pattern: string,
  vars: Readonly<Record<string, string>>,
): SourceKeySubstitution {
  const unresolved = new Set<string>();
  const key = pattern.replace(SOURCE_KEY_PATTERN_TOKEN, (token: string, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      const value = vars[name];
      if (typeof value === "string") {
        return value;
      }
    }
    unresolved.add(name);
    return token;
  });
  return { key, unresolved: [...unresolved] };
}
