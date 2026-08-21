/**
 * The unsaved-edit guard (`F2.5`, ADR 0038).
 *
 * The interesting assertions here are the two *permissive* cases. A guard that
 * blocks everything passes any test that only checks the blocking path, and it
 * is also useless — the author learns to dismiss it without reading. So
 * "clicking the open tab is not a navigation" and "a clean tab never prompts"
 * are asserted first and deliberately.
 */
import { TEMPLATE_TABS, type TemplateTabId } from "./template-tabs";
import { guardTabSwitch, templateTabLabel } from "./template-tab-guard";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const IDS = TEMPLATE_TABS.map((tab) => tab.id);

/** Clicking the tab already open is never a navigation, dirty or not. */
export function runSameTabTests(): void {
  for (const id of IDS) {
    for (const dirty of [true, false]) {
      const decision = guardTabSwitch(id, id, dirty);
      assert(
        decision.allow,
        `re-selecting the open tab must not prompt (${id}, dirty=${dirty})`,
      );
    }
  }
}

/** A clean tab hands over silently, across every ordered pair. */
export function runCleanTabTests(): void {
  for (const from of IDS) {
    for (const to of IDS) {
      const decision = guardTabSwitch(from, to, false);
      assert(decision.allow, `a clean ${from} must not block a switch to ${to}`);
    }
  }
}

/**
 * A dirty tab blocks every switch away from it.
 *
 * Asserted over all twenty ordered pairs rather than one example, because the
 * defect was that *all five* tabs lost state — a guard wired to one of them
 * would satisfy a single-case test and leave four tabs still losing edits.
 */
export function runDirtyTabTests(): void {
  let blocked = 0;
  for (const from of IDS) {
    for (const to of IDS) {
      if (from === to) {
        continue;
      }
      const decision = guardTabSwitch(from, to, true);
      assert(!decision.allow, `a dirty ${from} must block a switch to ${to}`);
      blocked += 1;
    }
  }
  // Anti-vacuity: if the registry or this loop ever stopped producing pairs,
  // every assertion above would pass by never running. Five tabs give twenty
  // ordered pairs.
  assert(blocked === 20, `expected 20 blocked pairs, checked ${blocked}`);
}

/**
 * The dialog can always be rendered, and it names both tabs.
 *
 * The union makes "blocked with no message" unrepresentable at the type level;
 * this checks the strings are actually usable — a blocked decision carrying an
 * empty prompt or an empty button label renders a dialog the author cannot act
 * on, and would type-check perfectly.
 */
export function runPromptContentTests(): void {
  const decision = guardTabSwitch("points", "alarms", true);
  assert(!decision.allow, "a dirty Points must block");
  if (decision.allow) {
    return;
  }

  for (const [field, value] of [
    ["prompt", decision.prompt],
    ["confirmLabel", decision.confirmLabel],
    ["cancelLabel", decision.cancelLabel],
  ] as const) {
    assert(value.trim() !== "", `${field} must not be blank`);
  }

  const pointsLabel = templateTabLabel("points");
  const alarmsLabel = templateTabLabel("alarms");
  assert(
    decision.prompt.includes(pointsLabel),
    `the prompt must name the tab being left, got "${decision.prompt}"`,
  );
  assert(
    decision.prompt.includes(alarmsLabel),
    `the prompt must name the tab being opened, got "${decision.prompt}"`,
  );
  // The destructive button must name the destruction. "OK" is what an author
  // clicks without reading.
  assert(
    /discard/i.test(decision.confirmLabel),
    `the confirm button must say what it discards, got "${decision.confirmLabel}"`,
  );
  assert(
    decision.cancelLabel.includes(pointsLabel),
    `the cancel button must name the tab kept, got "${decision.cancelLabel}"`,
  );
}

/**
 * The prompt reads the registry rather than restating it.
 *
 * If a tab were relabelled, a hardcoded string here would leave the dialog
 * naming something the strip no longer shows. Checked by asserting every
 * registry label is the one the guard uses.
 *
 * **This assertion has a known blind spot, recorded rather than hidden.** The
 * mutation run for this module hardcoded `"Points"` into `templateTabLabel`
 * and every test here still passed — correctly, because `"Points"` *is* what
 * the registry says today, so the hardcode and the lookup agree on all five
 * tabs. No behavioural test can separate "reads the registry" from "happens to
 * match it"; the registry is a `const`, so a spec cannot relabel a tab and
 * watch the prompt follow.
 *
 * A source scan of this module, in the style of
 * `tests/adr-0038-template-authoring-ui.test.ts`, would close it. That was
 * judged disproportionate: the failure needs both a hardcode *and* a later
 * relabel, and its consequence is a dialog naming a stale tab name — the guard
 * still blocks the switch and no edit is lost. Revisit if tab labels ever
 * become editable or translated, which would turn a cosmetic drift into a
 * routine one.
 */
export function runLabelSourceTests(): void {
  for (const tab of TEMPLATE_TABS) {
    assert(
      templateTabLabel(tab.id) === tab.label,
      `the guard must use the strip's label for ${tab.id}`,
    );
  }
  // An id outside the registry cannot arrive through `TemplateTabId`, but the
  // lookup must still not return `undefined` into the middle of a sentence.
  assert(
    templateTabLabel("nope" as TemplateTabId) === "nope",
    "an unknown id must fall back to itself, never to undefined",
  );
}
