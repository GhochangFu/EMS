/**
 * The detail page's tab registry (`F2.5`, ADR 0038 decision 2 — Unit 7).
 *
 * ADR 0038 names **exactly six** tabs, and names them so that the closed
 * sections cannot arrive by accident:
 *
 * - `optimisation` is rejected outright by `templateContentSchema` (`E1.6` owns
 *   it), so a tab for it would always error, which is worse than no tab;
 * - `maintenance` is deliberately omitted — ADR 0038 *Not in this ADR*;
 * - **`health` moved from the first class to the second in `E1.3`.** ADR 0050
 *   decision 7 reopened the tier, so the API now accepts it and this UI carries
 *   it through `mergeTemplateContent` untouched. It still has no tab: ADR 0050
 *   Amendment 1 decision 5 scopes `E1.3` to the score surfaces, and a seventh
 *   tab is an ADR 0038 amendment, not a side effect of a backlog row. Do not
 *   add one here without it.
 *
 * **`dashboards` was the third of these until `F3.1e`, and it is now the sixth
 * tab.** This docblock used to read *"the dashboard section carries only an
 * ordering today, which belongs on the Points tab as `sortOrder`. It becomes a
 * tab when `F3.1` gives it widgets."* `F3.1a` gave it widgets in `b0b4f3f`, so
 * [ADR 0038](../../../../docs/adr/0038-template-authoring-ui.md) Amendment 4
 * discharged that condition rather than restating it. The `sortOrder` control
 * on the Points tab is untouched and the two surfaces coexist — Amendment 4
 * rules that explicitly, so do not "tidy" one of them away.
 *
 * ## Why this is in `lib/` and not beside the strip that renders it
 *
 * The plan put the registry in `components/asset-templates/template-tab-strip.tsx`.
 * It is here instead, for the reason Unit 5 had to learn twice: `apps/web`'s
 * Vitest project runs `environment: "node"` over `src/**\/*.test.ts`, so a
 * `.tsx` is unreachable by any test in this repository, and the coverage gate's
 * `include` reaches `apps/web/src/lib/**` and nothing above it.
 * `resolveTemplateTab` is a real rule with a real fallback, so it must be
 * somewhere a test can see it. The strip stays a `.tsx` and holds no logic.
 *
 * **Unit 8 must scan this file, not the strip.**
 *
 * ## The registry is scanned as text, not only as a type
 *
 * A type cannot stop someone adding a seventh tab, so Unit 8's invariant reads
 * this file's source and extracts the entries. The registry is therefore a flat
 * array literal, one entry per line, `id` first, with a bare string literal —
 * no computed key, no spread, no construction from another module.
 *
 * `id:` followed by a quoted value appears nowhere else here, so the extraction
 * is unambiguous:
 *
 * ```
 * [...source.matchAll(/\bid:\s*"([a-z]+)"/g)].map((match) => match[1])
 * ```
 *
 * That returns exactly `details, points, calculations, kpis, alarms,
 * dashboards`, verified against this file when `F3.1e` added the sixth entry.
 * Anyone changing the shape below must
 * re-run it — a broken regex returns nothing and reads as compliance, which is
 * why Unit 8 must also fail on an empty scan.
 */

/** The six tabs, and the only six. */
export type TemplateTabId = "details" | "points" | "calculations" | "kpis" | "alarms" | "dashboards";

export type TemplateTab = {
  id: TemplateTabId;
  label: string;
  /** One line under the tab strip, saying what this tab writes. */
  hint: string;
};

export const TEMPLATE_TABS: readonly TemplateTab[] = [
  { id: "details", label: "Details", hint: "Name, asset type, domain and description." },
  { id: "points", label: "Points", hint: "The point keys this template declares, and how each one maps." },
  { id: "calculations", label: "Calculations", hint: "Formulas for derived points, and when each one runs." },
  { id: "kpis", label: "KPIs", hint: "Named expressions over this template's points." },
  { id: "alarms", label: "Alarms", hint: "Thresholds, severities and the knowledge behind each one." },
  { id: "dashboards", label: "Dashboards", hint: "Which points a dashboard shows, and the widgets drawn from them." },
];

/** The tab a bare detail URL opens. */
export const DEFAULT_TEMPLATE_TAB: TemplateTabId = "details";

/**
 * Resolves a `?tab=` value to a tab id.
 *
 * An unknown or absent value falls back to Details rather than rendering
 * nothing. The value comes from the URL, so it can be anything a person typed,
 * a stale bookmark, or a tab that existed in an earlier version — and a page
 * that renders no body at all reads as broken rather than as a bad link.
 */
export function resolveTemplateTab(value: string | undefined | null): TemplateTabId {
  const match = TEMPLATE_TABS.find((tab) => tab.id === value);
  return match ? match.id : DEFAULT_TEMPLATE_TAB;
}
