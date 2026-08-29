/**
 * The tab registry (`F2.5`, ADR 0038 decision 2 — Unit 7).
 *
 * These assertions cover the **behaviour**. The count and the ids are also
 * asserted against this file's *source text* by Unit 8, because a type cannot
 * stop someone adding a sixth entry and a behavioural test that read the
 * registry would simply agree with whatever it found.
 */
import {
  DEFAULT_TEMPLATE_TAB,
  TEMPLATE_TABS,
  resolveTemplateTab,
} from "./template-tabs";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Six tabs, the six ADR 0038 names, in the ADR's order (Amendment 4). */
export function runRegistryShapeTests(): void {
  assert(
    TEMPLATE_TABS.length === 6,
    `ADR 0038 Amendment 4 names six tabs, got ${TEMPLATE_TABS.length}`,
  );
  assert(
    TEMPLATE_TABS.map((tab) => tab.id).join(",") ===
      "details,points,calculations,kpis,alarms,dashboards",
    `the registry drifted — got ${TEMPLATE_TABS.map((tab) => tab.id).join(",")}`,
  );
  assert(
    new Set(TEMPLATE_TABS.map((tab) => tab.id)).size === TEMPLATE_TABS.length,
    "no id may repeat",
  );
  for (const tab of TEMPLATE_TABS) {
    assert(tab.label.trim().length > 0, `${tab.id} needs a label`);
    assert(tab.hint.trim().length > 0, `${tab.id} needs a hint saying what it writes`);
  }
}

/**
 * The closed sections have no tab.
 *
 * The two reserved keys are refused by `templateContentSchema`, so a tab for
 * either would always error — worse than no tab. `maintenance` is deliberately
 * omitted. **`dashboards` left this list in `F3.1e`** (ADR 0038 Amendment 4):
 * it carried only an ordering when this was written, and `F3.1a` gave it
 * widgets, which is the condition decision 2 set for it becoming a tab.
 * Asserted over the ids rather than trusted to the count: six tabs is still six
 * tabs if one of
 * them is the wrong one.
 */
export function runNoClosedSectionTabTests(): void {
  const ids = TEMPLATE_TABS.map((tab) => tab.id as string);
  for (const closed of ["health", "optimisation", "maintenance"]) {
    assert(!ids.includes(closed), `${closed} has no tab in this ADR — got ${ids.join(",")}`);
  }
}

/**
 * A `?tab=` value the page cannot honour falls back to Details.
 *
 * The value comes from the URL, so it can be a typo, a stale bookmark, or a tab
 * name from an earlier version. Returning `undefined` would render no body at
 * all, which reads as a broken page rather than as a bad link.
 */
export function runResolveTabTests(): void {
  assert(DEFAULT_TEMPLATE_TAB === "details", "a bare detail URL opens Details");

  for (const tab of TEMPLATE_TABS) {
    assert(resolveTemplateTab(tab.id) === tab.id, `${tab.id} must resolve to itself`);
  }

  // Ordered deliberately: a plausible-but-wrong id comes **first**. A resolver
  // that trusted its input without checking would still reject `""` and `null`
  // by accident, so a loop that tested those first would fail with a message
  // about the empty string and hide the case that actually matters — a URL
  // naming a tab that does not exist, rendering a body for it.
  // `"dashboards"` left this list in `F3.1e`, and it is a **different** removal
  // from the closed-section one above — ADR 0038 Amendment 4 rules the two
  // separately for that reason. This list is about ids that must NOT resolve;
  // once `dashboards` is a real tab, asserting it falls back to Details
  // contradicts the "every tab id resolves to itself" loop directly. The other
  // six entries stay, and the ordering note above still holds: `"nonsense"` is
  // the plausible-but-wrong id and stays first.
  for (const bad of ["nonsense", "health", "Details", "", undefined, null]) {
    assert(
      resolveTemplateTab(bad) === DEFAULT_TEMPLATE_TAB,
      `${JSON.stringify(bad)} must fall back to Details, got ${resolveTemplateTab(bad)}`,
    );
  }

  // `"Details"` is in that list on purpose: the ids are lower-case and the
  // comparison is exact, so a capitalised link is a miss and not a match.
  assert(resolveTemplateTab("kpis") === "kpis", "the lower-case id is the one that matches");
}
