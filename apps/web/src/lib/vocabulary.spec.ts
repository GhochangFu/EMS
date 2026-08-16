import { badgeToneSchema } from "@bms/shared/contracts";
import { DEFAULT_RULE_CATEGORY_CODE } from "@bms/shared";
import type { RuleCategoryDto } from "@bms/shared";

import {
  defaultCategoryCode,
  defaultDomainCode,
  labelFor,
  toneClass,
  toneFor,
} from "./vocabulary";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `F4.45`. Every case here is about **not reproducing `F4.43`** — a badge that
 * renders blank, or worse, renders as something the row is not.
 *
 * The vocabularies are data now, so there is no union to enumerate and no
 * exhaustiveness the compiler can check. What is left to test is precisely the
 * behaviour at the edges the type system can no longer see: an unknown code, an
 * unloaded vocabulary, an unknown tone.
 */
export function runVocabularyTests(): void {
  const categories: RuleCategoryDto[] = [
    { code: "safety", label: "Safety", tone: "critical", sortOrder: 10, active: true },
    { code: "operations", label: "Operations", tone: "neutral", sortOrder: 40, active: true },
  ];

  // ---------------------------------------------------------------------
  // Every declared tone maps to real classes
  // ---------------------------------------------------------------------

  const tones = badgeToneSchema.options;

  // Anti-vacuity floor: an empty options list would make the loop assert nothing.
  assert(tones.length >= 5, `expected at least 5 badge tones, got ${tones.length}`);

  const seenClasses = new Set<string>();
  for (const tone of tones) {
    const classes = toneClass(tone);
    assert(
      classes.trim().length > 0,
      `tone ${tone} produced no classes — this is F4.43's unstyled badge, which ` +
        "rendered the literal class \"undefined\" for 48 of 89 rules",
    );
    assert(
      !classes.includes("undefined"),
      `tone ${tone} produced "${classes}", which contains "undefined"`,
    );
    seenClasses.add(classes);
  }

  // Distinct tones must look distinct, or the tone column is decoration.
  assert(
    seenClasses.size === tones.length,
    `${tones.length} tones produced only ${seenClasses.size} distinct styles — ` +
      "two tones an operator cannot tell apart",
  );

  // ---------------------------------------------------------------------
  // Unknown and unloaded inputs degrade to plain, never to wrong
  // ---------------------------------------------------------------------

  assert(
    toneClass(undefined).trim().length > 0,
    "an absent tone must still produce a styled badge, not an empty class string",
  );

  assert(
    toneFor(categories, "safety") === "critical",
    "a known category must resolve to its declared tone",
  );
  assert(
    toneFor(categories, "not_seeded_yet") === "neutral",
    "an unknown category must fall back to neutral rather than throwing — a newly " +
      "seeded domain pack can reach a browser running an older bundle",
  );
  assert(
    toneFor(undefined, "safety") === "neutral",
    "the vocabulary is fetched, so every consumer has a render before it arrives",
  );

  // ---------------------------------------------------------------------
  // A label never disappears
  // ---------------------------------------------------------------------

  assert(labelFor(categories, "safety") === "Safety", "a known code must show its label");

  // The specific F4.43 shape: the row holds a value the UI does not recognise.
  // Showing the raw code keeps the row *legible and diagnosable*; showing "" or
  // "Unknown" is what made `electrical` invisible for as long as it was.
  assert(
    labelFor(categories, "electrical") === "electrical",
    "an unrecognised code must render as itself, not blank and not a placeholder",
  );
  assert(
    labelFor(undefined, "safety") === "safety",
    "before the vocabulary loads, the code is still better than nothing",
  );
  assert(labelFor(categories, null) === "", "a null code has nothing to show");

  // ---------------------------------------------------------------------
  // Defaults come from the vocabulary, not from a literal
  // ---------------------------------------------------------------------

  // The fixture deliberately puts `safety` first, as `sort_order` does in the
  // real seed. An earlier version of this returned `categories[0]` and this
  // assertion pinned `"safety"` — so the builder opened on Safety while the
  // API's `ruleDraftBodySchema` still defaulted an omitted field to
  // `operations`. A form showing one concern while the server would store
  // another is F4.44's control/state divergence by another route, and the test
  // was asserting it rather than catching it.
  assert(
    defaultCategoryCode(categories) === DEFAULT_RULE_CATEGORY_CODE,
    `a new draft must start on the server's own default (${DEFAULT_RULE_CATEGORY_CODE}), ` +
      "not on whichever concern happens to sort first",
  );

  // …but the vocabulary is data, so the default may not be on offer. Retiring
  // that row must not leave the builder defaulting to something absent from its
  // own <select> — which is the index-0 fallback in the other direction.
  assert(
    defaultCategoryCode([categories[0]]) === "safety",
    "when the server default is not offered, fall back to the first entry that is",
  );
  assert(
    defaultCategoryCode([]) === DEFAULT_RULE_CATEGORY_CODE,
    "an empty vocabulary must still yield a usable default rather than undefined",
  );
  assert(
    defaultDomainCode(undefined) === "electrical",
    "the asset form needs a default before the vocabulary arrives",
  );
}
