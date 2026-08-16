import { authorableRuleCategorySchema } from "@bms/shared/contracts";
import type { AuthorableRuleCategory, AutomationRuleCategory } from "@bms/shared";

/**
 * `F4.44` — reconciling the two rule-category vocabularies at the *authoring*
 * surface, which is where `F4.43` left a hole.
 *
 * A rule's category can be any of five on the way **out** and only four on the
 * way **in** (ADR 0030 Amendment 3). The rule builder is an authoring surface,
 * so its `<select>` may only offer the four — but the same builder is opened to
 * *edit* existing rules, 48 of which carry `electrical`, written directly by
 * `packages/db/drizzle/0022_phe_alarm_threshold_rules.sql`.
 *
 * **The failure this replaces was not a blank control, and that is the point.**
 * A `<select>` cannot hold a value with no matching `<option>`, so the browser
 * falls back to index 0 while React's state keeps the real value. Measured on
 * the running stack: the DOM read `operations` and rendered "Operations" while
 * React held `electrical`. A blank control looks broken; that one looked
 * *correct* and was not — the form asserted a category the rule did not have.
 * Saving it then failed with `invalid_enum_value` on a field the operator was
 * never shown, or silently reclassified the rule if they "fixed" the value they
 * could see was wrong.
 *
 * This module is the whole decision, kept pure and out of the component so it
 * can be tested at all: `vitest.config.ts` counts only `apps/web/src/lib/**`
 * toward coverage, so logic left in a `.tsx` is untestable *and* invisible to
 * the gate (AGENTS.md §2, Frontend).
 *
 * **It is written for the class, not for `electrical`.** Nothing here names
 * that value. Any member of the read union the builder does not offer takes the
 * same path, so a sixth one fires this rather than falling back to index 0.
 */

/**
 * The categories the builder may offer, **read from the write schema rather
 * than restated** (AGENTS.md §4.8). `rules.schema.ts` re-exports this same
 * schema, so the control, the API's validator and ADR 0019's template alarms
 * all move together or not at all.
 */
export const authorableCategories: readonly AuthorableRuleCategory[] =
  authorableRuleCategorySchema.options;

/**
 * Display names for **every** category, readable ones included.
 *
 * `Record<AutomationRuleCategory, string>` is load-bearing: adding a member to
 * the union makes this a compile error rather than yielding `undefined`, which
 * is exactly how `F4.43`'s empty badge happened. Shared with `rules-panel.tsx`
 * so the badge, the filter and the builder cannot disagree about a name.
 */
export const categoryLabels: Record<AutomationRuleCategory, string> = {
  comfort: "Comfort",
  energy: "Energy",
  safety: "Safety",
  operations: "Operations",
  electrical: "Electrical",
};

/** Whether an operator may author this category — i.e. the API will accept it. */
export function isAuthorableCategory(
  category: AutomationRuleCategory,
): category is AuthorableRuleCategory {
  return (authorableCategories as readonly string[]).includes(category);
}

export type CategoryAuthoring = {
  /**
   * What the `<select>` binds to. Always a value the control actually offers,
   * so it can never fall back to index 0 behind the user's back.
   */
  selected: AuthorableRuleCategory;
  /**
   * The rule's real category when it is **not** operator-authorable, and `null`
   * otherwise. Non-null means: render it read-only, and leave it out of the
   * payload so the server keeps what it already has.
   */
  locked: AutomationRuleCategory | null;
};

/**
 * Placeholder for `selected` while a category is locked.
 *
 * It is never rendered and never submitted — the locked branch hides the
 * `<select>` and omits the field — but the form still needs a value of the
 * narrow type. Chosen to match `ruleDraftBodySchema`'s own
 * `.default("operations")` so that if it ever *did* escape, it would escape as
 * the same value the server would have picked.
 */
const PLACEHOLDER: AuthorableRuleCategory = "operations";

/** How a rule's stored category should be presented for editing. */
export function categoryAuthoring(category: AutomationRuleCategory): CategoryAuthoring {
  return isAuthorableCategory(category)
    ? { selected: category, locked: null }
    : { selected: PLACEHOLDER, locked: category };
}

/**
 * Drops `category` from a draft payload when it is locked.
 *
 * **Verified against the real schemas rather than assumed**, because
 * `mergeRuleDraft` spreads the DTO over the stored row and — unlike its
 * neighbours — gives `category` no explicit `=== undefined` check, so an
 * `undefined` reaching the spread would clear it. Zod omits absent optional
 * keys from its output entirely, so the key is not merely `undefined`, it is
 * absent: parsing `{ thresholdValue: 240 }` through `ruleUpdateBodySchema`
 * yields keys `["thresholdValue","reason"]` and `mergeRuleDraft` then returns
 * `category: "electrical"` unchanged. Editing a PHE rule's threshold therefore
 * saves, and cannot silently reclassify it.
 *
 * For `POST /rules/preview` the omission is harmless: the preview schema
 * defaults the field, `evaluateRule` never reads it, and the `rule_preview`
 * audit row records `code`/`name`/`status`/`matched` only — so no false
 * category reaches `bms.audit_log`, which ADR 0021 makes a veracity surface.
 */
export function omitLockedCategory<T extends { category: AuthorableRuleCategory }>(
  payload: T,
  locked: AutomationRuleCategory | null,
): T | Omit<T, "category"> {
  if (locked === null) {
    return payload;
  }
  const { category: _locked, ...rest } = payload;
  return rest;
}
