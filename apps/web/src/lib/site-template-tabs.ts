/**
 * `F4.320` (ADR 0087 Amendment 4 decision 1) — the tab edits of a site template draft.
 *
 * A site template (`target = 'site'`) holds every widget inside `content.tabs`, so the detail
 * page edits the tab list and each tab's widgets together. These are pure functions over that
 * list, kept out of the `.tsx` for the reason `dashboard-builder-form.ts` gives: a handler in a
 * component is outside the coverage denominator.
 *
 * **Not the builder's tab helpers.** `addBuilderTab` and its siblings work on a live dashboard's
 * `TabWritePayload` (an `assetGroupId`, widgets carried as rows with a `tabKey`). A template tab
 * carries a `domain` and a `groupCode` instead, and owns its widgets as a nested list.
 *
 * The server's rules (unique keys, the tab cap, the per-tab widget cap, the references a
 * `module_summary_card` and a mimic make to a tab) stay the only gate. These functions refuse
 * only what would make the editor's own state ambiguous: two tabs with one key, or a key the
 * route segment can never hold.
 */
import { DASHBOARD_GRID, MAX_DASHBOARD_TABS, dashboardTabKeySchema } from "@bms/shared";
import type { DashboardTemplateDto } from "@bms/shared";

import type { SectionTemplateWidgetInput } from "../api/admin/dashboard-templates";

/** One tab of a site template, as the editor holds it: the read shape with editable widgets. */
export type TemplateTabInput = Omit<DashboardTemplateDto["content"]["tabs"][number], "widgets"> & {
  widgets: SectionTemplateWidgetInput[];
};

/** The answer of an edit that can be refused: the new list, or the sentence that says why not. */
export type TabEditResult =
  | { readonly ok: true; readonly tabs: TemplateTabInput[] }
  | { readonly ok: false; readonly problem: string };

let nextWidgetOrdinal = 1;

/**
 * A stable, template-local widget key an author never has to type — see
 * `sectionTemplateWidgetIdentitySchema`'s docblock on why `key` exists at all. Timestamp-prefixed
 * so a fresh session's counter cannot collide with a key a previous session already saved.
 */
export function freshWidgetKey(): string {
  return `widget-${Date.now()}-${nextWidgetOrdinal++}`;
}

/** A new widget as the canvas adds it: a value tile of the minimum size, bound to nothing. */
export function blankTemplateWidget(): SectionTemplateWidgetInput {
  return {
    key: freshWidgetKey(),
    title: null,
    gridX: 0,
    gridY: 0,
    gridW: DASHBOARD_GRID.minWidgetW,
    gridH: DASHBOARD_GRID.minWidgetH,
    bindings: [],
    sources: [],
    widgetType: "value_tile",
    config: {},
  };
}

/** The list with `sortOrder` renumbered from position, so the order saved is the order shown. */
function renumbered(tabs: readonly TemplateTabInput[]): TemplateTabInput[] {
  return tabs.map((tab, position) => ({ ...tab, sortOrder: position }));
}

/** The list with tab `index` replaced by `patch(tab)`; an index past the end answers a copy. */
function patchTab(
  tabs: readonly TemplateTabInput[],
  index: number,
  patch: (tab: TemplateTabInput) => TemplateTabInput,
): TemplateTabInput[] {
  return tabs.map((tab, position) => (position === index ? patch(tab) : tab));
}

/**
 * Adds an Overview-style tab (no domain, no widgets) with the first free `tab-N` key, at the end.
 * Answers `null` at `MAX_DASHBOARD_TABS`: the server refuses a ninth tab.
 */
export function addTemplateTab(
  tabs: readonly TemplateTabInput[],
): { readonly tabs: TemplateTabInput[]; readonly index: number } | null {
  if (tabs.length >= MAX_DASHBOARD_TABS) return null;
  const taken = new Set(tabs.map((tab) => tab.key));
  let n = 1;
  while (taken.has(`tab-${n}`)) n += 1;
  const added: TemplateTabInput = { key: `tab-${n}`, label: `Tab ${n}`, sortOrder: 0, domain: null, widgets: [] };
  return { tabs: renumbered([...tabs, added]), index: tabs.length };
}

/** Sets a tab's label as typed; the schema's `min(1)` refuses an empty one at Review. */
export function renameTemplateTab(
  tabs: readonly TemplateTabInput[],
  index: number,
  label: string,
): TemplateTabInput[] {
  return patchTab(tabs, index, (tab) => ({ ...tab, label }));
}

/** The config field of each widget type that names a tab of the same template. */
const TAB_NAMING_FIELD: Partial<Record<SectionTemplateWidgetInput["widgetType"], string>> = {
  module_summary_card: "targetTabKey",
  mimic: "tabKey",
};

/** `widget` with the tab reference `from` moved to `to`; any other widget is answered as it is. */
function withTabReferenceMoved(
  widget: SectionTemplateWidgetInput,
  from: string,
  to: string,
): SectionTemplateWidgetInput {
  const field = TAB_NAMING_FIELD[widget.widgetType];
  const config = widget.config as Record<string, unknown>;
  if (field === undefined || config[field] !== from) return widget;
  // The cast is the one `updateWidget` on the page explains: the type and the config's shape are
  // unchanged, only one string field of it moved.
  return { ...widget, config: { ...config, [field]: to } } as SectionTemplateWidgetInput;
}

/** The sentence for a key the tab key schema refuses. */
export const TAB_KEY_FORMAT_PROBLEM = "A tab key is 1 to 64 lowercase letters, digits and hyphens.";

/**
 * Changes a tab's key, and moves every reference to the old key with it — a module summary
 * card's `targetTabKey` and a mimic's `tabKey`, in every tab — else the renamed template fails
 * its own tab-reference rules and cannot be saved.
 *
 * Refused when the key fails `dashboardTabKeySchema` (the format, or a key the site page owns,
 * `RESERVED_DASHBOARD_TAB_KEYS`), or when another tab already holds it: two tabs with one key
 * cannot be told apart again by any later edit.
 */
export function rekeyTemplateTab(tabs: readonly TemplateTabInput[], index: number, key: string): TabEditResult {
  const tab = tabs[index];
  if (tab === undefined) return { ok: true, tabs: [...tabs] };
  if (key === tab.key) return { ok: true, tabs: [...tabs] };
  const parsed = dashboardTabKeySchema.safeParse(key);
  if (!parsed.success) {
    const reserved = parsed.error.issues.some((issue) => issue.code === "custom");
    return { ok: false, problem: reserved ? `The tab key "${key}" is reserved for the site page.` : TAB_KEY_FORMAT_PROBLEM };
  }
  if (tabs.some((other, position) => position !== index && other.key === key)) {
    return { ok: false, problem: `Another tab already uses the key "${key}".` };
  }
  const from = tab.key;
  return {
    ok: true,
    tabs: tabs.map((other, position) => ({
      ...other,
      ...(position === index ? { key } : {}),
      widgets: other.widgets.map((widget) => withTabReferenceMoved(widget, from, key)),
    })),
  };
}

/** Moves one tab by `delta` places and renumbers `sortOrder`. A move past either end is a copy. */
export function moveTemplateTab(tabs: readonly TemplateTabInput[], index: number, delta: -1 | 1): TemplateTabInput[] {
  const target = index + delta;
  if (index < 0 || index >= tabs.length || target < 0 || target >= tabs.length) return [...tabs];
  const next = [...tabs];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return renumbered(next);
}

/**
 * Removes one tab **and its widgets**. A card or a mimic elsewhere that named the tab keeps the
 * reference, and the schema's tab-reference rule names it at Review — the same as the builder.
 */
export function removeTemplateTab(tabs: readonly TemplateTabInput[], index: number): TemplateTabInput[] {
  return renumbered(tabs.filter((_, position) => position !== index));
}

/** Sets a tab's domain code, or `null` for an Overview (no group). */
export function setTemplateTabDomain(
  tabs: readonly TemplateTabInput[],
  index: number,
  domain: string | null,
): TemplateTabInput[] {
  return patchTab(tabs, index, (tab) => ({ ...tab, domain }));
}

/** Sets a tab's `groupCode` tie-break; a blank one removes the key (the field is optional, `min(1)`). */
export function setTemplateTabGroupCode(
  tabs: readonly TemplateTabInput[],
  index: number,
  groupCode: string,
): TemplateTabInput[] {
  return patchTab(tabs, index, (tab) => {
    const { groupCode: _dropped, ...rest } = tab;
    const trimmed = groupCode.trim();
    return trimmed === "" ? rest : { ...rest, groupCode: trimmed };
  });
}

/** Replaces one tab's widgets with `update(widgets)`. */
export function withTabWidgets(
  tabs: readonly TemplateTabInput[],
  index: number,
  update: (widgets: SectionTemplateWidgetInput[]) => SectionTemplateWidgetInput[],
): TemplateTabInput[] {
  return patchTab(tabs, index, (tab) => ({ ...tab, widgets: update(tab.widgets) }));
}

/**
 * The tab index a refusal names, or `null`.
 *
 * Takes a Zod issue path (`["content", "tabs", 1, "widgets", 0, "config"]`) or a problem line as
 * the wizard writes one (`"content.tabs.1.widgets.0.config: Expected number"`,
 * `bodyProblems` in `wizard-steps.ts`). Only a path that starts at `content.tabs.<i>` names a tab.
 *
 * **The API's `400` cannot be read this way.** `PATCH /admin/dashboard-templates/:id` throws
 * `new BadRequestException(err.flatten())`, and `flatten()` collapses every path to its top-level
 * key: the body is `{ formErrors, fieldErrors: { content: [...] } }`, with no index. The wizard's
 * Review parses the same `updateDashboardTemplateBodySchema` before Submit, so every schema
 * refusal is found here, with its full path, before a request is sent.
 */
export function tabIndexOfProblem(problem: string | readonly PropertyKey[]): number | null {
  const path = typeof problem === "string" ? (problem.split(":")[0] ?? "").trim().split(".") : problem.map(String);
  if (path[0] !== "content" || path[1] !== "tabs" || path[2] === undefined) return null;
  return /^\d+$/.test(path[2]) ? Number(path[2]) : null;
}

/** The first problem line that names a tab, with that tab's index; `null` when none does. */
export function firstTabProblem(
  problems: readonly string[],
): { readonly index: number; readonly message: string } | null {
  for (const problem of problems) {
    const index = tabIndexOfProblem(problem);
    if (index !== null) return { index, message: problem };
  }
  return null;
}
