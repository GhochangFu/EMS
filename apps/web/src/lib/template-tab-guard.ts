import { TEMPLATE_TABS, type TemplateTabId } from "./template-tabs";

/**
 * The unsaved-edit guard for the five authoring tabs (`F2.5`, ADR 0038).
 *
 * ## The defect this closes
 *
 * `TemplateTabBody` renders one tab component per `?tab=` value, so switching
 * tabs unmounts the open editor and React discards its state. Every unsaved
 * edit went with it, silently — no prompt, no trace, and the author's next view
 * is a clean form that looks correct. It affected all five tabs.
 *
 * ## Why the rule lives here and not in the page
 *
 * `apps/web`'s Vitest project runs `environment: "node"` over
 * `src/**\/*.test.ts`, so a `.tsx` is unreachable by every test in this
 * repository and invisible to the coverage gate. The page keeps only the
 * wiring — which tab is open, whether it reported itself dirty, and rendering
 * the dialog. Every decision is here.
 *
 * ## The guard must not use `window.confirm`
 *
 * A native `confirm()` would be three lines and is the obvious reach. It is
 * ruled out on purpose: a browser modal blocks the page's event loop, which
 * makes the §7 verification pass — and any future automated check — unable to
 * drive the screen past the first dirty tab switch. So `guardTabSwitch`
 * returns the prompt text rather than asking the question itself, and the page
 * renders an ordinary in-app dialog with it.
 *
 * ## What is deliberately not guarded
 *
 * Leaving the **page** — the Back link, the browser's own back button, closing
 * the window — is not covered. That needs a `beforeunload` handler or a router
 * blocker, which is a different mechanism with its own failure modes, and the
 * measured defect was tab switching. Recorded so the gap is a decision rather
 * than an oversight.
 */

/**
 * What the page should do about a requested tab switch.
 *
 * A discriminated union rather than a boolean plus an optional string: it makes
 * "blocked with no message to show" unrepresentable, which is the state that
 * would render an empty dialog.
 */
export type TabSwitchDecision =
  | { allow: true }
  | { allow: false; prompt: string; confirmLabel: string; cancelLabel: string };

/** The label the strip shows, so the prompt names the tab the author sees. */
export function templateTabLabel(tab: TemplateTabId): string {
  return TEMPLATE_TABS.find((entry) => entry.id === tab)?.label ?? tab;
}

/**
 * Decides whether a tab switch may proceed.
 *
 * Three cases, and the first two matter as much as the third:
 *
 * - **Same tab.** Clicking the tab already open is not a navigation. Prompting
 *   there would train the author to dismiss the dialog without reading it,
 *   which is how a guard stops working.
 * - **Clean tab.** Nothing to lose, so nothing to ask.
 * - **Dirty tab.** Blocked, with a prompt naming the tab being left. The name
 *   comes from the registry rather than being written out here, so a relabelled
 *   tab cannot leave the dialog referring to a name the strip no longer shows.
 */
export function guardTabSwitch(
  current: TemplateTabId,
  next: TemplateTabId,
  dirty: boolean,
): TabSwitchDecision {
  if (next === current) {
    return { allow: true };
  }
  if (!dirty) {
    return { allow: true };
  }
  return {
    allow: false,
    // Says what is unsaved, what happens, and what the author can do instead.
    // "Discard" rather than "OK" because the destructive choice must name
    // itself — an author clicking through a dialog reads the buttons, not the
    // paragraph.
    prompt: `${templateTabLabel(current)} has unsaved changes. Leaving this tab discards them. Save first, or discard and continue to ${templateTabLabel(next)}.`,
    confirmLabel: `Discard and open ${templateTabLabel(next)}`,
    cancelLabel: `Stay on ${templateTabLabel(current)}`,
  };
}
