/**
 * The unsaved-edit guard (`F2.5`, ADR 0038).
 *
 * The interesting assertions here are the two *permissive* cases. A guard that
 * blocks everything passes any test that only checks the blocking path, and it
 * is also useless — the author learns to dismiss it without reading. So
 * "clicking the open tab is not a navigation" and "a clean tab never prompts"
 * are asserted first and deliberately.
 */
import { capabilities } from "./template-lifecycle";
import type { TemplateLifecycleAction } from "./template-lifecycle";
import { TEMPLATE_TABS, type TemplateTabId } from "./template-tabs";
import { guardLifecycleAction, guardTabSwitch, templateTabLabel } from "./template-tab-guard";

const ACTIONS: TemplateLifecycleAction[] = [
  "publish",
  "delete",
  "archive",
  "createDraft",
  "instantiate",
];

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

/**
 * Every lifecycle action is guarded when a tab is dirty.
 *
 * The tab guard closed one route to silent edit loss and left this one open.
 * On a draft — the only status where the tabs are editable — Publish and
 * Delete sit above the tabs and neither consulted the dirty flag. Publish is
 * the one that matters: it sends the **stored** version while the screen keeps
 * showing the author's unsaved one, so unlike a discard, nothing on screen
 * indicates what happened.
 */
export function runLifecycleGuardTests(): void {
  for (const action of ACTIONS) {
    const clean = guardLifecycleAction(action, "points", false);
    assert(clean.allow, `${action} must proceed when nothing is unsaved`);

    const dirty = guardLifecycleAction(action, "points", true);
    assert(!dirty.allow, `${action} must not proceed over an unsaved edit`);
    if (dirty.allow) {
      continue;
    }
    assert(dirty.prompt.trim() !== "", `${action} needs a prompt`);
    assert(dirty.confirmLabel.trim() !== "", `${action} needs a confirm label`);
    assert(dirty.cancelLabel.trim() !== "", `${action} needs a cancel label`);
    assert(
      dirty.prompt.includes(templateTabLabel("points")),
      `${action} must name the tab holding the edit, got "${dirty.prompt}"`,
    );
    assert(
      /discard/i.test(dirty.confirmLabel),
      `${action}'s confirm button must name the discard, got "${dirty.confirmLabel}"`,
    );
  }
}

/**
 * Each action explains its own consequence, and Publish says the specific
 * thing.
 *
 * One shared "you have unsaved changes" would be true and useless. Publish is
 * not a discard: the version that ships is the stored one, and it can never be
 * edited afterwards. An author who reads "changes will be lost" and accepts it
 * has still not been told what will actually be published.
 */
export function runActionConsequenceTests(): void {
  const prompts = new Map<TemplateLifecycleAction, string>();
  for (const action of ACTIONS) {
    const decision = guardLifecycleAction(action, "details", true);
    assert(!decision.allow, `${action} must block`);
    if (!decision.allow) {
      prompts.set(action, decision.prompt);
    }
  }

  // No two actions may share wording — that is what makes the prompt worth
  // reading rather than something to click through.
  assert(
    new Set(prompts.values()).size === ACTIONS.length,
    "each action must explain its own consequence, not share one message",
  );

  const publish = prompts.get("publish") ?? "";
  assert(
    /stored version/i.test(publish),
    `Publish must say that the stored version ships, got "${publish}"`,
  );
  assert(
    /cannot be edited/i.test(publish),
    `Publish must say the result cannot be edited, got "${publish}"`,
  );
}

/**
 * Anti-vacuity, and the reason this list cannot quietly go stale.
 *
 * `ACTIONS` above is hand-written, so a sixth action added to
 * `TemplateLifecycleAction` would be guarded by `guardLifecycleAction` — its
 * `Record` would not compile without an entry — but would not be *tested*
 * here. This ties the list to the capability table, which is the same source
 * the page reads when it decides which buttons to render.
 */
export function runActionCoverageTests(): void {
  const offered = new Set<TemplateLifecycleAction>();
  for (const status of ["draft", "published", "archived"] as const) {
    for (const action of capabilities(status).actions) {
      offered.add(action);
    }
  }
  assert(offered.size > 0, "the capability table offered no actions — this scan is broken");
  for (const action of offered) {
    assert(
      ACTIONS.includes(action),
      `${action} is offered by the capability table but is not covered by these tests`,
    );
  }

  // The two that can actually be reached while a tab is dirty, named
  // explicitly: `draft` is the only status with `editable: true`.
  const draftActions = capabilities("draft").actions;
  assert(
    draftActions.includes("publish") && draftActions.includes("delete"),
    `the editable status must still offer publish and delete, got ${draftActions.join(",")}`,
  );
}
