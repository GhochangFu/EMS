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
