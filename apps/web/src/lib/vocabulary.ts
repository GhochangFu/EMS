import { DEFAULT_RULE_CATEGORY_CODE } from "@bms/shared";
import type { AssetDomainDto, BadgeTone, RuleCategoryDto } from "@bms/shared";

/**
 * Pure helpers over the two open vocabularies (ADR 0031 Amendment 1).
 *
 * ## Why this replaced `rule-category-authoring.ts`
 *
 * That module derived the builder's `<select>` options from a `z.enum`, which
 * was the right answer while the vocabulary was a compile-time union. Both
 * vocabularies are now rows — `bms.rule_categories` and `bms.asset_domains` —
 * because the roadmap schedules three domain packs (`E5.1` water-treatment,
 * `E5.2` mechanical/utility, `E5.3` facility/smart-building) and a fixed list
 * would have needed a migration and a deploy per sector.
 *
 * So the options come from `GET /api/v1/vocabularies` now, and what is left to
 * put in a pure module is the part that is still logic: resolving a code to a
 * label, and a tone to a class.
 *
 * Kept in `lib/` deliberately — `vitest.config.ts` counts only
 * `apps/web/src/lib/**` toward coverage, so logic left in a `.tsx` is
 * untestable *and* invisible to the gate (AGENTS.md §2, Frontend).
 */

/**
 * Tailwind classes per badge tone.
 *
 * **This is the piece that keeps `F4.43` from happening again.** That defect
 * was an exhaustive `switch` over the category union returning `undefined` for
 * `electrical` — a value the type system said could not occur — so 48 of 89
 * rules rendered with the literal class `"undefined"`: unstyled, unfilterable,
 * and invisible to the compiler.
 *
 * With the vocabulary open, a `switch` over *categories* could not be
 * exhaustive at all. Switching over **tone** can be, because tone is a closed
 * presentation vocabulary owned by this app and pinned by
 * `rule_categories_tone_check` in the database. A newly seeded category cannot
 * arrive unstyled: it must carry one of these five.
 */
const TONE_CLASSES: Record<BadgeTone, string> = {
  critical: "border-red-200 bg-red-50 text-red-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  positive: "border-bms-green/20 bg-bms-green/10 text-bms-green",
  informational: "border-sky-200 bg-sky-50 text-sky-700",
  neutral: "border-gray-200 bg-white text-bms-muted",
};

/**
 * Classes for a category badge.
 *
 * Falls back to `neutral` rather than throwing or returning `undefined`. The
 * fallback is reachable only if the API serves a tone this build does not know
 * — a deployment skew — and in that case a plain badge is the right outcome:
 * `F4.43` proved that the failure mode worth designing against is a badge that
 * renders *wrong*, not one that renders plain.
 */
export function toneClass(tone: BadgeTone | undefined): string {
  return (tone && TONE_CLASSES[tone]) || TONE_CLASSES.neutral;
}

/**
 * The display label for a code, or the code itself if the vocabulary has not
 * loaded or does not contain it.
 *
 * Returning the raw code is deliberate. The alternatives are worse: an empty
 * string reproduces `F4.43`'s blank badge exactly, and a placeholder like
 * "Unknown" hides which value the row actually holds — the specific thing that
 * made `electrical` invisible for as long as it was.
 */
export function labelFor(
  vocabulary: readonly { code: string; label: string }[] | undefined,
  code: string | null | undefined,
): string {
  if (!code) {
    return "";
  }
  return vocabulary?.find((entry) => entry.code === code)?.label ?? code;
}

/** The tone declared for a category code, `neutral` when it is not known yet. */
export function toneFor(
  categories: readonly RuleCategoryDto[] | undefined,
  code: string | null | undefined,
): BadgeTone {
  if (!code) {
    return "neutral";
  }
  return categories?.find((entry) => entry.code === code)?.tone ?? "neutral";
}

/**
 * The category a fresh draft starts on.
 *
 * **Matches the server's own default**, which is the point: `ruleDraftBodySchema`
 * defaults an omitted category to `DEFAULT_RULE_CATEGORY_CODE`, and a form that
 * starts somewhere else shows the operator one concern while an unsent field
 * would store another. An earlier version returned `categories[0]`, which meant
 * the builder opened on `Safety` — first by `sort_order` — while the server
 * still said `operations`. That is `F4.44`'s divergence between a control and
 * the state behind it, arriving by a different route.
 *
 * Falls back to the first offered entry when the default is not on the list,
 * because the vocabulary is data: retiring that row with `active = false` must
 * not leave the builder defaulting to something it does not offer.
 */
export function defaultCategoryCode(
  categories: readonly RuleCategoryDto[] | undefined,
): string {
  const preferred = categories?.find(
    (category) => category.code === DEFAULT_RULE_CATEGORY_CODE,
  );
  return preferred?.code ?? categories?.[0]?.code ?? DEFAULT_RULE_CATEGORY_CODE;
}

/**
 * The domain a fresh asset form starts on.
 *
 * No server-side counterpart to match here — `createAssetBodySchema` requires
 * `domain` rather than defaulting it, deliberately, since ADR 0031 decision 7
 * dropped the column's `DEFAULT 'electrical'` precisely so that unstated plant
 * is an error rather than a guess. This only picks which option the form opens
 * on, and the operator must still confirm it.
 */
export function defaultDomainCode(domains: readonly AssetDomainDto[] | undefined): string {
  return domains?.[0]?.code ?? "electrical";
}
