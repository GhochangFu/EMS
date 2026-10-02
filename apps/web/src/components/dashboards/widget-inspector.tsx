import {
  DASHBOARD_GRID,
  MAX_SITE_ALARM_ROWS,
  METRIC_CATALOG,
  MIMIC_PRESETS,
  mimicPresetSchema,
  widgetTypeBindsNothing,
} from "@bms/shared";
import type { AssetPointPickerRow, MetricCatalogKey, MimicPreset, UserRole, WidgetPointRole } from "@bms/shared";

import { widgetRowAfterRemovingSource } from "../../lib/dashboard-builder-form";
import type { DashboardBuilderProblem, DashboardWidgetRow } from "../../lib/dashboard-builder-form";
import { useMimicLayouts } from "../../hooks/use-mimic-layouts";
import { metricCatalogLabel } from "../../lib/metric-catalog";
import { WIDGET_CATALOG } from "../../lib/widget-catalog";
import {
  AGGREGATE_FUNCTION_LABELS,
  AGGREGATE_FUNCTIONS,
  MAX_WIDGET_TITLE_LENGTH,
  WIDGET_ICON_LABELS,
  WIDGET_ICONS,
  WIDGET_TONES,
  type WidgetConfigRow,
} from "../../lib/widget-config-form";
import { Field } from "../asset-templates/field";
import { ChartSeriesPicker } from "./chart-series-picker";
import { MetricSourcePicker } from "./metric-source-picker";
import { PointPicker } from "./point-picker";
import { TableColumnPicker } from "./table-column-picker";

type WidgetInspectorProps = {
  row: DashboardWidgetRow;
  /** Pre-filtered to this widget's own index — `problems.filter(p => p.widget === index)`,
   * the same shape `dashboards-tab.tsx`'s `viewProblems` gives `DashboardViewEditor`. */
  problems: readonly DashboardBuilderProblem[];
  /** The author's role — `PointPicker` forks its chain on it (`F3.63`, ADR 0047 Amendment 6
   * §Q1 point 4); required, not optional, so a caller that omits it fails `tsc` rather than
   * silently rendering the master-data chain to an `asset_group_admin`. */
  role: UserRole;
  organizationId: string;
  /** `F3.73` — the dashboard's tabs, for a module summary card's target select. Required, so a
   * host that forgets it fails `tsc` rather than silently disabling the select; `[]` is a
   * dashboard with no tabs (a new one, or a legacy canvas), where the select says so. */
  tabs: readonly { readonly key: string; readonly label: string; readonly assetGroupId: string | null }[];
  onChange: (patch: Partial<DashboardWidgetRow>) => void;
  onRemove: () => void;
};

/**
 * `F3.1d` Unit 7 — one widget's whole editing surface: type (fixed after
 * creation), title, the four grid inputs, the config form (Unit 1's
 * `widget-config-form.ts`), and the point bindings (`point-picker.tsx`).
 *
 * **The four grid inputs are the affordance that must work** (plan §4) — always
 * available and keyboard-accessible, independent of the pointer drag/resize
 * layer on `dashboard-canvas.tsx`. Follows the `F3.1e` precedent
 * (`dashboard-widget-editor.tsx`'s `WidgetEditor`) field for field, over the
 * live row/config shapes instead of the template ones.
 *
 * **Role is derived from `widgetType`, never asked of the author.** Every
 * type but `chart` caps at one binding (`WIDGET_POINT_CARDINALITY`), so its
 * one point is always `"primary"`; a `chart` accepts many, and each is a
 * `"series"` entry in its legend. There is no widget type whose points are a
 * mix of both roles, so a role selector would only ever offer one correct
 * answer — not a control worth adding.
 */
export function WidgetInspector({ row, problems, role, organizationId, tabs, onChange, onRemove }: WidgetInspectorProps) {
  const problemFor = (field: string): string | undefined =>
    problems.find((problem) => problem.field === field)?.message;
  const cardinality = WIDGET_CATALOG[row.widgetType].points;
  const sourceCardinality = WIDGET_CATALOG[row.widgetType].sources;
  // The bound entry, but only when it is a DATASET — the column picker has nothing to offer for
  // a metric, and `WIDGET_SOURCE_SHAPES` already guarantees a table never holds one. Computed
  // here rather than inside the JSX so the condition below reads as one question.
  const boundDataset = row.sources
    .map((source) => source.catalogKey)
    .find((key) => METRIC_CATALOG[key].shape === "dataset");
  // `F3.32c` (ADR 0081) — called unconditionally (rules of hooks), like every other hook this
  // component reads regardless of `row.widgetType`; the library select below is the only reader.
  // A global admin's `list()` holds every organization's layouts; a widget may name only its
  // dashboard's organization's (the API answers 400 otherwise), so the others are not offered.
  const layoutsQuery = useMimicLayouts();
  const layouts = (layoutsQuery.data?.items ?? []).filter((layout) => layout.organizationId === organizationId);
  const storedLayoutId = row.config.mimicLayoutId;
  const mimicSource = row.config.mimicSource ?? "preset";
  // `F3.74` — the tabs a mimic may resolve through, and whether its own tab already binds a group.
  const groupTabs = tabs.filter((tab) => tab.assetGroupId !== null);
  const mimicOwnTabBindsGroup = groupTabs.some((tab) => tab.key === row.tabKey);

  function updateConfig(patch: Partial<WidgetConfigRow>): void {
    onChange({ config: { ...row.config, ...patch } });
  }

  function addPoint(point: AssetPointPickerRow): void {
    const role: WidgetPointRole = row.widgetType === "chart" ? "series" : "primary";
    onChange({
      points: [
        ...row.points,
        {
          pointId: point.id,
          role,
          sortOrder: row.points.length,
          label: point.unit ? `${point.pointKey} (${point.unit})` : point.pointKey,
        },
      ],
    });
  }

  function removePoint(index: number): void {
    onChange({
      points: row.points
        .filter((_, position) => position !== index)
        .map((point, position) => ({ ...point, sortOrder: position })),
    });
  }

  /**
   * `F3.35` Stage C — adding a named metric.
   *
   * **`params: {}` and nothing else, deliberately.** Every entry this picker offers has the
   * write schema `z.object({}).strict()`; the two sustainability entries declare
   * `{ pointKey, aggregate }` (`E4.2`, ADR 0072) and `catalogKeysFor` hides them here, since
   * `{}` would be refused with a 400 the author cannot act on. A scope id in particular is
   * the ADR 0019 problem the binding
   * contract exists to refuse: a binding inherits the DASHBOARD's scope, so an id in `params`
   * would be a second, contradictory answer sitting in jsonb that no foreign key covers.
   */
  function addSource(catalogKey: MetricCatalogKey): void {
    onChange({ sources: [...row.sources, { catalogKey, params: {} }] });
  }

  /** `F3.35` Stage B — the decision (and why it clears the columns) is
   * `widgetRowAfterRemovingSource`'s, in `dashboard-builder-form.ts`, where it is tested. */
  function removeSource(index: number): void {
    onChange(widgetRowAfterRemovingSource(row, index));
  }

  function setTableColumns(tableColumns: string[]): void {
    onChange({ config: { ...row.config, tableColumns } });
  }

  return (
    <section className="surface-raised-sm space-y-3 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          {WIDGET_CATALOG[row.widgetType].label}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="surface-button border-critical-line px-2 py-0.5 text-[11px] text-critical-ink"
        >
          Remove
        </button>
      </div>

      <Field label="Title" error={problemFor("title")}>
        <input
          type="text"
          value={row.title}
          maxLength={MAX_WIDGET_TITLE_LENGTH}
          placeholder={WIDGET_CATALOG[row.widgetType].label}
          onChange={(event) => onChange({ title: event.target.value })}
          className="surface-field w-full px-2 py-1.5 text-xs"
        />
      </Field>

      {/*
        `F3.73` D11 — the tab this widget sits on, on a dashboard with tabs. Choosing another tab
        moves the widget there (the page's canvas follows it).
      */}
      {tabs.length > 0 ? (
        <Field label="Tab" error={problemFor("tabKey")}>
          <select
            value={row.tabKey ?? ""}
            onChange={(event) => onChange({ tabKey: event.target.value })}
            className="surface-field w-full px-2 py-1.5 text-xs"
          >
            {row.tabKey === undefined || !tabs.some((tab) => tab.key === row.tabKey) ? (
              <option value={row.tabKey ?? ""}>{row.tabKey ?? "Choose a tab"}</option>
            ) : null}
            {tabs.map((tab) => (
              <option key={tab.key} value={tab.key}>
                {tab.label.trim() || tab.key}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <div className="grid grid-cols-4 gap-2">
        <Field label="gridX" error={problemFor("gridX")}>
          <input
            type="number"
            min={0}
            max={DASHBOARD_GRID.columns - 1}
            value={row.gridX}
            onChange={(event) => onChange({ gridX: Number(event.target.value) })}
            className="surface-field w-full px-2 py-1.5 text-xs"
          />
        </Field>
        <Field label="gridY" error={problemFor("gridY")}>
          <input
            type="number"
            min={0}
            value={row.gridY}
            onChange={(event) => onChange({ gridY: Number(event.target.value) })}
            className="surface-field w-full px-2 py-1.5 text-xs"
          />
        </Field>
        <Field label="gridW" error={problemFor("gridW")}>
          <input
            type="number"
            min={DASHBOARD_GRID.minWidgetW}
            max={DASHBOARD_GRID.columns}
            value={row.gridW}
            onChange={(event) => onChange({ gridW: Number(event.target.value) })}
            className="surface-field w-full px-2 py-1.5 text-xs"
          />
        </Field>
        <Field label="gridH" error={problemFor("gridH")}>
          <input
            type="number"
            min={DASHBOARD_GRID.minWidgetH}
            max={DASHBOARD_GRID.maxWidgetH}
            value={row.gridH}
            onChange={(event) => onChange({ gridH: Number(event.target.value) })}
            className="surface-field w-full px-2 py-1.5 text-xs"
          />
        </Field>
      </div>

      {/*
        `F3.32` / plan D8 — a mimic's config has no `unit` or `decimals`: it draws several
        nodes, each with its own points and units, so one widget-level value would apply to
        nothing and the API's `.strict()` would refuse it. `F3.73`: the five site widgets
        likewise — a type that binds nothing has no value to format.
      */}
      {!widgetTypeBindsNothing(row.widgetType) ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Unit" error={problemFor("unit")}>
            <input
              type="text"
              value={row.config.unit}
              placeholder="none"
              onChange={(event) => updateConfig({ unit: event.target.value })}
              className="surface-field w-full px-2 py-1.5 text-xs"
            />
          </Field>
          <Field label="Decimals" error={problemFor("decimals")}>
            <input
              type="text"
              inputMode="numeric"
              value={row.config.decimals}
              placeholder="not set"
              onChange={(event) => updateConfig({ decimals: event.target.value })}
              className="surface-field w-full px-2 py-1.5 text-xs"
            />
          </Field>
        </div>
      ) : null}

      {row.widgetType === "mimic" ? (
        <Field label="Source">
          <select
            value={mimicSource}
            onChange={(event) => updateConfig({ mimicSource: event.target.value as "preset" | "layout" })}
            className="surface-field w-full px-2 py-1.5 text-xs"
          >
            <option value="preset">Preset</option>
            <option value="layout">Layout</option>
          </select>
        </Field>
      ) : null}

      {row.widgetType === "mimic" && mimicSource === "preset" ? (
        <Field label="Preset" error={problemFor("preset")}>
          <select
            value={row.config.mimicPreset ?? ""}
            onChange={(event) => updateConfig({ mimicPreset: event.target.value as MimicPreset })}
            className="surface-field w-full px-2 py-1.5 text-xs"
          >
            {row.config.mimicPreset === undefined ? <option value="">Choose a plant drawing</option> : null}
            {mimicPresetSchema.options.map((preset) => (
              <option key={preset} value={preset}>
                {MIMIC_PRESETS[preset].label}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {/*
        `F3.32c` (ADR 0081) — the organization's layout library, read through `useMimicLayouts`.
        Shown only when the author has chosen this source, hiding the Preset select above.
      */}
      {row.widgetType === "mimic" && mimicSource === "layout" ? (
        <Field label="Layout" error={problemFor("layout")}>
          <select
            value={row.config.mimicLayoutId ?? ""}
            onChange={(event) => updateConfig({ mimicLayoutId: event.target.value || undefined })}
            className="surface-field w-full px-2 py-1.5 text-xs"
          >
            {storedLayoutId === undefined ? <option value="">Choose a layout</option> : null}
            {/* A stored id the list does not hold (still loading, failed, or not this
                organization's) keeps its own option, so the select never shows another name. */}
            {storedLayoutId !== undefined && !layouts.some((layout) => layout.id === storedLayoutId) ? (
              <option value={storedLayoutId}>{storedLayoutId}</option>
            ) : null}
            {layouts.map((layout) => (
              <option key={layout.id} value={layout.id}>
                {layout.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {/*
        `F3.74` (plan D7) — a mimic on a tab that binds no asset group resolves through the group-bound
        tab named here (`config.tabKey`); the select lists only those tabs, the API's rule. A mimic on a
        group-bound tab of its own resolves through that tab, so it shows no select. `compact` is the
        preset arm's only field (the layout arm's schema has none).
      */}
      {row.widgetType === "mimic" && !mimicOwnTabBindsGroup ? (
        <Field label="Resolves through tab" error={problemFor("mimicTabKey")}>
          <select
            value={row.config.mimicTabKey ?? ""}
            onChange={(event) => updateConfig({ mimicTabKey: event.target.value || undefined })}
            className="surface-field w-full px-2 py-1.5 text-xs"
          >
            <option value="">None</option>
            {row.config.mimicTabKey !== undefined && !groupTabs.some((tab) => tab.key === row.config.mimicTabKey) ? (
              <option value={row.config.mimicTabKey}>{row.config.mimicTabKey}</option>
            ) : null}
            {groupTabs.map((tab) => (
              <option key={tab.key} value={tab.key}>
                {tab.label}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {row.widgetType === "mimic" && mimicSource === "preset" ? (
        <label className="flex items-center gap-2 text-xs text-ink">
          <input
            type="checkbox"
            checked={row.config.mimicCompact ?? false}
            onChange={(event) => updateConfig({ mimicCompact: event.target.checked })}
          />
          Compact — labels, switches and pills only
        </label>
      ) : null}

      {row.widgetType === "active_alarms_rail" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Rows" error={problemFor("railRows")}>
            <input
              type="text"
              inputMode="numeric"
              value={row.config.railRows ?? ""}
              placeholder={`1 to ${MAX_SITE_ALARM_ROWS}`}
              onChange={(event) => updateConfig({ railRows: event.target.value })}
              className="surface-field w-full px-2 py-1.5 text-xs"
            />
          </Field>
          <label className="flex items-center gap-2 text-xs text-ink">
            <input
              type="checkbox"
              checked={row.config.railShowSummary ?? true}
              onChange={(event) => updateConfig({ railShowSummary: event.target.checked })}
            />
            Show the Alarm Summary tab
          </label>
        </div>
      ) : null}

      {/*
        `F3.73` — the card's target is one of THIS dashboard's tabs (the API refuses any other key).
        A dashboard with no tabs offers none, so the select is disabled with the reason beside it;
        a tab added in the edit page's Tabs panel appears here on the next render.
      */}
      {row.widgetType === "module_summary_card" ? (
        <Field label="Links to tab" error={problemFor("targetTabKey")}>
          <select
            value={row.config.targetTabKey ?? ""}
            disabled={tabs.length === 0}
            onChange={(event) => updateConfig({ targetTabKey: event.target.value || undefined })}
            className="surface-field w-full px-2 py-1.5 text-xs"
          >
            {row.config.targetTabKey === undefined ? <option value="">Choose a tab</option> : null}
            {/* A stored key the dashboard no longer has keeps its own option, so the select never
                shows another tab's name; the API refuses the save until the author re-chooses. */}
            {row.config.targetTabKey !== undefined && !tabs.some((tab) => tab.key === row.config.targetTabKey) ? (
              <option value={row.config.targetTabKey}>{row.config.targetTabKey}</option>
            ) : null}
            {tabs.map((tab) => (
              <option key={tab.key} value={tab.key}>
                {tab.label}
              </option>
            ))}
          </select>
          {tabs.length === 0 ? (
            <p className="mt-1 text-[11px] text-ink-muted">This dashboard has no tabs yet, so there is nothing to link to.</p>
          ) : null}
        </Field>
      ) : null}

      {row.widgetType === "radial_gauge" ? (
        <div className="space-y-2">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Minimum" error={problemFor("min")}>
              <input
                type="text"
                inputMode="decimal"
                value={row.config.min}
                onChange={(event) => updateConfig({ min: event.target.value })}
                className="surface-field w-full px-2 py-1.5 text-xs"
              />
            </Field>
            <Field label="Maximum" error={problemFor("max")}>
              <input
                type="text"
                inputMode="decimal"
                value={row.config.max}
                onChange={(event) => updateConfig({ max: event.target.value })}
                className="surface-field w-full px-2 py-1.5 text-xs"
              />
            </Field>
          </div>
          <Field label="Threshold bands" error={problemFor("thresholds")}>
            <div className="space-y-1">
              {row.config.thresholds.map((threshold, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={threshold.value}
                    placeholder="value"
                    onChange={(event) =>
                      updateConfig({
                        thresholds: row.config.thresholds.map((entry, position) =>
                          position === index ? { ...entry, value: event.target.value } : entry,
                        ),
                      })
                    }
                    className="surface-field w-24 px-2 py-1 text-xs"
                  />
                  <select
                    value={threshold.tone}
                    onChange={(event) =>
                      updateConfig({
                        thresholds: row.config.thresholds.map((entry, position) =>
                          position === index
                            ? { ...entry, tone: event.target.value as (typeof WIDGET_TONES)[number] }
                            : entry,
                        ),
                      })
                    }
                    className="surface-field px-2 py-1 text-xs"
                  >
                    {WIDGET_TONES.map((tone) => (
                      <option key={tone} value={tone}>
                        {tone}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      updateConfig({
                        thresholds: row.config.thresholds.filter((_, position) => position !== index),
                      })
                    }
                    className="surface-button border-critical-line px-2 py-0.5 text-[11px] text-critical-ink"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  updateConfig({ thresholds: [...row.config.thresholds, { value: "", tone: "ok" }] })
                }
                className="surface-button px-2 py-1 text-[11px]"
              >
                Add a threshold band
              </button>
            </div>
          </Field>
        </div>
      ) : null}

      {row.widgetType === "tank_level" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Full scale" error={problemFor("fullScale")}>
            <input
              type="text"
              inputMode="decimal"
              value={row.config.fullScale}
              onChange={(event) => updateConfig({ fullScale: event.target.value })}
              className="surface-field w-full px-2 py-1.5 text-xs"
            />
          </Field>
          <Field label="Fill tone">
            <select
              value={row.config.fillTone}
              onChange={(event) => updateConfig({ fillTone: event.target.value as WidgetConfigRow["fillTone"] })}
              className="surface-field w-full px-2 py-1.5 text-xs"
            >
              <option value="">not set</option>
              {WIDGET_TONES.map((tone) => (
                <option key={tone} value={tone}>
                  {tone}
                </option>
              ))}
            </select>
          </Field>
        </div>
      ) : null}

      {row.widgetType === "value_tile" ? (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={row.config.abbreviate}
              onChange={(event) => updateConfig({ abbreviate: event.target.checked })}
            />
            Abbreviate large values (1.2k, 3.4M)
          </label>

          {/*
            `F3.35` — the two ways to get a number, side by side rather than on
            two screens. ADR 0048 decision 3 accepted knowingly that a builder
            now has both a point-with-a-function and a named metric; the single
            picker is the mitigation, and this select is the "no aggregate"
            default that keeps the original behaviour one option away.
          */}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Show">
              <select
                value={row.config.aggregate}
                onChange={(event) =>
                  updateConfig({ aggregate: event.target.value as WidgetConfigRow["aggregate"] })
                }
                className="surface-field w-full px-2 py-1.5 text-xs"
              >
                <option value="">Latest reading</option>
                {AGGREGATE_FUNCTIONS.map((fn) => (
                  <option key={fn} value={fn}>
                    {AGGREGATE_FUNCTION_LABELS[fn]} over a window
                  </option>
                ))}
              </select>
            </Field>
            {row.config.aggregate !== "" ? (
              <Field label="Window (minutes)" error={problemFor("windowMinutes")}>
                <input
                  type="text"
                  inputMode="numeric"
                  value={row.config.windowMinutes}
                  placeholder="1440 (default)"
                  onChange={(event) => updateConfig({ windowMinutes: event.target.value })}
                  className="surface-field w-full px-2 py-1.5 text-xs"
                />
              </Field>
            ) : null}
          </div>

          {row.config.aggregate !== "" ? (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={row.config.compareToPrevious}
                onChange={(event) => updateConfig({ compareToPrevious: event.target.checked })}
              />
              Compare with the previous window (shows a delta)
            </label>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Icon">
              <select
                value={row.config.icon}
                onChange={(event) =>
                  updateConfig({ icon: event.target.value as WidgetConfigRow["icon"] })
                }
                className="surface-field w-full px-2 py-1.5 text-xs"
              >
                <option value="">No icon</option>
                {WIDGET_ICONS.map((icon) => (
                  <option key={icon} value={icon}>
                    {WIDGET_ICON_LABELS[icon]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tone">
              <select
                value={row.config.tone}
                onChange={(event) =>
                  updateConfig({ tone: event.target.value as WidgetConfigRow["tone"] })
                }
                className="surface-field w-full px-2 py-1.5 text-xs"
              >
                <option value="">Default</option>
                {WIDGET_TONES.map((tone) => (
                  <option key={tone} value={tone}>
                    {tone}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* Hidden while a delta occupies the slot — the tile shows one line,
              and a box whose value never renders is worse than an absent one. */}
          {row.config.aggregate !== "" && row.config.compareToPrevious ? null : (
            <Field label="Sub-line" error={problemFor("hint")}>
              <input
                type="text"
                value={row.config.hint}
                placeholder="e.g. Since midnight"
                onChange={(event) => updateConfig({ hint: event.target.value })}
                className="surface-field w-full px-2 py-1.5 text-xs"
              />
            </Field>
          )}
        </div>
      ) : null}

      {row.widgetType === "chart" ? (
        <div className="space-y-2">
          <Field label="Chart kind" error={problemFor("series")}>
            <ChartSeriesPicker value={row.config.series} onChange={(series) => updateConfig({ series })} />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Window (minutes)" error={problemFor("windowMinutes")}>
              <input
                type="text"
                inputMode="numeric"
                value={row.config.windowMinutes}
                placeholder="1440 (default)"
                onChange={(event) => updateConfig({ windowMinutes: event.target.value })}
                className="surface-field w-full px-2 py-1.5 text-xs"
              />
            </Field>
            <Field label="Y-axis label" error={problemFor("yAxisLabel")}>
              <input
                type="text"
                value={row.config.yAxisLabel}
                onChange={(event) => updateConfig({ yAxisLabel: event.target.value })}
                className="surface-field w-full px-2 py-1.5 text-xs"
              />
            </Field>
          </div>
          <Field label="Plot">
            <select
              value={row.config.chartAggregate}
              onChange={(event) =>
                updateConfig({
                  chartAggregate: event.target.value as WidgetConfigRow["chartAggregate"],
                })
              }
              className="surface-field w-full px-2 py-1.5 text-xs"
            >
              <option value="">Every reading</option>
              {AGGREGATE_FUNCTIONS.map((fn) => (
                <option key={fn} value={fn}>
                  {AGGREGATE_FUNCTION_LABELS[fn]} per bucket
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={row.config.stacked}
              onChange={(event) => updateConfig({ stacked: event.target.checked })}
            />
            Stack series
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={row.config.footerStats}
              onChange={(event) => updateConfig({ footerStats: event.target.checked })}
            />
            Show peak, average and granularity below the chart
          </label>
        </div>
      ) : null}

      {/*
        `F3.32` — absent, not empty, for a type that binds no point (the plant mimic resolves its
        nodes from the dashboard's asset group), the way "Named metric" below is absent at
        `sourceCardinality.max === 0`.
      */}
      {cardinality.max > 0 ? (
        <Field label="Bound points" error={problemFor("points")}>
          <ul className="space-y-1">
            {row.points.map((point, index) => (
              <li
                key={`${point.pointId}-${index}`}
                className="surface-raised-sm flex items-center justify-between px-2 py-1 text-xs"
              >
                <span>{point.label}</span>
                <button type="button" onClick={() => removePoint(index)} aria-label={`Remove ${point.label}`} className="text-critical-ink">
                  ×
                </button>
              </li>
            ))}
          </ul>
          {/*
            `F3.35` Stage C — the picker disappears when a NAMED METRIC is bound, as well as at
            the cardinality maximum. A widget binds points or a metric, never both
            (`bindingExclusiveMessage`), so offering both pickers at once would let an author
            build a state the form refuses on the very next render — an error they were invited
            to make. `dashboardBuilderErrors` still enforces it, because a widget can arrive from
            the server in that state; this only stops the form from producing one.
          */}
          {row.points.length < cardinality.max && row.sources.length === 0 ? (
            <PointPicker role={role} organizationId={organizationId} onAdd={addPoint} />
          ) : null}
        </Field>
      ) : null}

      {/*
        Rendered only for a type that can bind one — a gauge, a tank and a chart draw a series
        over time and accept no catalog shape, so `WIDGET_SOURCE_CARDINALITY` gives them
        `max: 0` and this whole field is absent rather than empty.
      */}
      {/*
        No `error` here, deliberately (compliance review). Both binding kinds report through the
        `"points"` field — the exactly-one-kind rule is a relation between the two arrays, so it
        has no field of its own — and passing it to both `Field`s rendered the same sentence
        twice, which reads as two problems.
      */}
      {sourceCardinality.max > 0 ? (
        <Field label="Named metric">
          <ul className="space-y-1">
            {row.sources.map((source, index) => (
              <li
                key={`${source.catalogKey}-${index}`}
                className="surface-raised-sm flex items-center justify-between px-2 py-1 text-xs"
              >
                <span>{metricCatalogLabel(source.catalogKey)}</span>
                <button
                  type="button"
                  onClick={() => removeSource(index)}
                  aria-label={`Remove ${metricCatalogLabel(source.catalogKey)}`}
                  className="text-critical-ink"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          {row.sources.length < sourceCardinality.max && row.points.length === 0 ? (
            <MetricSourcePicker
              widgetType={row.widgetType}
              bound={row.sources.map((source) => source.catalogKey)}
              onAdd={addSource}
            />
          ) : null}
          {/*
            The column picker (ADR 0048 decision 2), shown only once a dataset is actually
            bound — its legal choices ARE that dataset's declared columns, so there is nothing
            to offer before then. Rendered inside the same `Field` because binding the source
            and projecting its columns are one decision an author makes in one place.
          */}
          {boundDataset !== undefined ? (
            <TableColumnPicker
              catalogKey={boundDataset}
              chosen={row.config.tableColumns}
              onChange={setTableColumns}
            />
          ) : null}
        </Field>
      ) : null}
    </section>
  );
}
