import { CALC_DIALECT_V2, parseFormula } from "@bms/shared";

/**
 * `F2.9` / ADR 0055 — the point keys a `bms-calc-v2` formula names *inside* its
 * own text.
 *
 * ## Why this exists at all
 *
 * `template_points_point_key_fkey` (migration `0058`) holds every key a
 * template *declares*. A cross-asset reference declares nothing: the key of
 * `sum({kw} @site)` or `{TX_01.kwh}` lives in a `varchar` formula, where no
 * constraint and no catalog check can see it. Without this, a template naming
 * a key the catalog does not have stores clean, publishes clean, and then
 * fails once per tick as a counted skip nobody is watching —
 * `AssetTemplatesAdminService.assertPointKeysActive` therefore reads this and
 * refuses at save time, where the author is still looking at the formula.
 *
 * ## Pure, and total
 *
 * A separate file rather than a private method because
 * `asset-templates.service.ts` is at the §4.5 whole-file cap. Pure keeps it
 * testable without a database; **total** is the load-bearing property: the
 * publish path re-validates *stored* rows, which zod never saw — a row written
 * by the seed, or before this guard existed, can hold an unparseable formula.
 * `parseFormula` returns a result rather than throwing, and an unparseable
 * formula yields no keys here. Refusing it is the sibling `superRefine`'s job
 * on the write path, and a throw here would turn a publish into a 500.
 *
 * The local `refs` of a formula are deliberately **not** reported: they are
 * declared in the same array and are already checked, both by the sibling rule
 * in `asset-templates.schema.ts` and by the catalog read this feeds.
 */

/**
 * The loosest shape both callers satisfy. `create`/`update` pass a parsed
 * `TemplatePointBody` (narrowed vocabularies); `publish` passes a raw
 * `template_points` row, whose `kind` and `formulaDialect` are plain
 * `varchar`s. Narrowing this to the parsed type would force a cast on the
 * stored path, which is the path that most needs to be read honestly.
 */
export interface CrossRefCandidatePoint {
  pointKey: string;
  kind?: string | null;
  formula?: string | null;
  formulaDialect?: string | null;
}

/**
 * The longest point key `assertPointKeysActive` will echo, and it is **the
 * DTO's own bound**: `pointKeyCode` in `asset-templates.schema.ts` is
 * `z.string().min(1).max(128)`. Choosing that number rather than something
 * smaller is what keeps the existing behaviour intact — every key that reaches
 * the message through the DTO is named in full, exactly as before, because
 * truncation cannot fire on a value zod already bounded. Only a key lifted out
 * of a formula can be longer, and that is the one this bounds.
 *
 * The sibling spec checks the two agree by parsing a key of this length and one
 * character more, so the number cannot drift silently.
 */
export const MAX_ECHOED_POINT_KEY_LENGTH = 128;

/** How many codes the message lists before it reports a count instead. A
 * `bms-calc-v2` formula may name many keys, and forty truncated codes is still
 * a long message assembled out of formula text. */
export const MAX_ECHOED_POINT_KEYS = 10;

/**
 * Bounds what a catalog refusal is allowed to echo back.
 *
 * `assertPointKeysActive` names every offending code on purpose — a caller told
 * only "invalid point key" has to bisect a 40-point template by hand. Until
 * `F2.9` every code it could name came from the DTO, bounded at 128 and
 * validated. `crossRefPointKeys` now feeds it keys lifted out of the **formula
 * string**, where the only limit is `MAX_FORMULA_LENGTH` (1000) and there is no
 * charset rule at all — so an unknown 900-character cross-reference key would
 * be echoed whole into an API error.
 *
 * **Truncate and cap, rather than report a bare count**, because the count-only
 * form would take the message's whole value away from the common case to guard
 * the rare one: the DTO keys are already within the bound, so truncation is a
 * no-op for them and every existing message is unchanged. The calc DSL's
 * no-echo discipline is the reason this is bounded at all —
 * `formatCalcError`'s docblock records the `parseStoredContent` incident, and
 * AGENTS.md §4.3 asks for rejections logged by field path.
 */
export function boundedMissingPointKeys(codes: readonly string[]): string[] {
  const listed = codes
    .slice(0, MAX_ECHOED_POINT_KEYS)
    .map((code) =>
      code.length > MAX_ECHOED_POINT_KEY_LENGTH
        ? `${code.slice(0, MAX_ECHOED_POINT_KEY_LENGTH)}… (truncated)`
        : code,
    );
  const withheld = codes.length - listed.length;
  return withheld > 0 ? [...listed, `and ${withheld} more`] : listed;
}

/** The point keys a `bms-calc-v2` formula names inside its own text, deduped. */
export function crossRefPointKeys(
  points: readonly CrossRefCandidatePoint[],
): { pointKey: string }[] {
  const found = new Set<string>();
  for (const point of points) {
    if (point.kind !== "derived" || !point.formula || point.formulaDialect !== CALC_DIALECT_V2) {
      continue;
    }
    const parsed = parseFormula(point.formula, { dialect: CALC_DIALECT_V2 });
    if (!parsed.ok) {
      continue;
    }
    for (const ref of parsed.crossRefs) {
      found.add(ref.pointKey);
    }
  }
  return [...found].map((pointKey) => ({ pointKey }));
}
