import { automationRuleCategorySchema } from "@bms/shared/contracts";
import type { AutomationRuleCategory } from "@bms/shared";

import {
  authorableCategories,
  categoryAuthoring,
  categoryLabels,
  isAuthorableCategory,
  omitLockedCategory,
} from "./rule-category-authoring";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `F4.44`. Every assertion here is about the **class** — a readable category the
 * builder does not offer — rather than about `electrical`, which is merely the
 * one that exists today. The two loops below derive their cases from the
 * schemas, so a sixth union member is covered the day it is added.
 */
export function runRuleCategoryAuthoringTests(): void {
  const readable = automationRuleCategorySchema.options;

  // ---------------------------------------------------------------------
  // The control's options are the write vocabulary, never a copy of it
  // ---------------------------------------------------------------------

  // Anti-vacuity floor: a broken import yielding `[]` would make every
  // "not offered" assertion below pass while checking nothing.
  assert(
    authorableCategories.length >= 4,
    `expected at least 4 authorable categories, got ${authorableCategories.length}`,
  );
  assert(
    readable.length > authorableCategories.length,
    "the readable vocabulary must be strictly wider than the authorable one — " +
      "if these are equal, F4.44's whole case is gone and this module should be deleted " +
      "rather than left passing",
  );

  for (const category of authorableCategories) {
    assert(
      isAuthorableCategory(category),
      `${category} is offered by the builder but not reported authorable`,
    );
  }

  // ---------------------------------------------------------------------
  // Every readable category resolves to something the control can render
  // ---------------------------------------------------------------------

  for (const category of readable) {
    const authoring = categoryAuthoring(category);

    assert(
      authorableCategories.includes(authoring.selected),
      `categoryAuthoring(${category}).selected is ${authoring.selected}, which the ` +
        "<select> does not offer — this is the index-0 fallback the item exists to stop",
    );

    assert(
      typeof categoryLabels[category] === "string" && categoryLabels[category].length > 0,
      `${category} has no display label, so a locked field would render blank`,
    );

    if (isAuthorableCategory(category)) {
      assert(
        authoring.locked === null && authoring.selected === category,
        `${category} is authorable and must stay editable and selected as itself`,
      );
    } else {
      assert(
        authoring.locked === category,
        `${category} is not authorable, so it must be locked and reported verbatim — ` +
          "showing a substitute is the defect, not the fix",
      );
    }
  }

  // ---------------------------------------------------------------------
  // The payload keeps or drops the field, and never sends `undefined`
  // ---------------------------------------------------------------------

  const base = { name: "L1 voltage critical", category: "operations" } as const;

  const unlocked = omitLockedCategory({ ...base }, null);
  assert(
    "category" in unlocked && unlocked.category === "operations",
    "an authorable category must be sent, or every ordinary edit stops working",
  );

  for (const category of readable.filter((c) => !isAuthorableCategory(c))) {
    const locked = omitLockedCategory({ ...base }, category);
    assert(
      !("category" in locked),
      `category must be ABSENT for a locked rule, not undefined — mergeRuleDraft ` +
        `spreads the DTO and gives category no undefined-check, so a present-but-undefined ` +
        `key would clear it (${category})`,
    );
    assert(
      !Object.prototype.hasOwnProperty.call(locked, "category"),
      "an own `category` property survives JSON.stringify as a key; it must not exist at all",
    );
    assert(
      (locked as { name: string }).name === base.name,
      "omitting the category must not disturb the rest of the payload",
    );
  }

  // ---------------------------------------------------------------------
  // The specific regression, pinned by name
  // ---------------------------------------------------------------------

  // Pinned separately from the loops above: the loops would still pass if
  // `electrical` were dropped from the read union, and dropping it is exactly
  // what F4.43 established must not happen.
  const electrical = "electrical" as AutomationRuleCategory;
  assert(
    readable.includes(electrical),
    "`electrical` left the read union — 48 PHE rules carry it in the database",
  );
  assert(
    categoryAuthoring(electrical).locked === electrical,
    "editing a PHE rule must lock its category rather than showing Operations",
  );
}
