import { DASHBOARD_GRID, METRIC_CATALOG } from "@bms/shared";
import type { AdminAssetPointDto, MetricCatalogKey, WidgetPointRole } from "@bms/shared";

import { widgetRowAfterRemovingSource } from "../../lib/dashboard-builder-form";
import type { DashboardBuilderProblem, DashboardWidgetRow } from "../../lib/dashboard-builder-form";
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
  organizationId: string;
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
export function WidgetInspector({ row, problems, organizationId, onChange, onRemove }: WidgetInspectorProps) {
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

  function updateConfig(patch: Partial<WidgetConfigRow>): void {
    onChange({ config: { ...row.config, ...patch } });
  }

  function addPoint(point: AdminAssetPointDto): void {
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
   * **`params: {}` and nothing else, deliberately.** Every entry's write schema is
   * `z.object({}).strict()` today, so any field added here would be refused with a 400 the
   * author cannot act on — and a scope id in particular is the ADR 0019 problem the binding
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
    <section className="space-y-3 rounded border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-bms-muted">
          {WIDGET_CATALOG[row.widgetType].label}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="rounded border border-red-200 px-2 py-0.5 text-[11px] font-semibold text-red-700"
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
          className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
        />
      </Field>

      <div className="grid grid-cols-4 gap-2">
        <Field label="gridX" error={problemFor("gridX")}>
          <input
            type="number"
            min={0}
            max={DASHBOARD_GRID.columns - 1}
            value={row.gridX}
            onChange={(event) => onChange({ gridX: Number(event.target.value) })}
            className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
          />
        </Field>
        <Field label="gridY" error={problemFor("gridY")}>
          <input
            type="number"
            min={0}
            value={row.gridY}
            onChange={(event) => onChange({ gridY: Number(event.target.value) })}
            className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
          />
        </Field>
        <Field label="gridW" error={problemFor("gridW")}>
          <input
            type="number"
            min={DASHBOARD_GRID.minWidgetW}
            max={DASHBOARD_GRID.columns}
            value={row.gridW}
            onChange={(event) => onChange({ gridW: Number(event.target.value) })}
            className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
          />
        </Field>
        <Field label="gridH" error={problemFor("gridH")}>
          <input
            type="number"
            min={DASHBOARD_GRID.minWidgetH}
            max={DASHBOARD_GRID.maxWidgetH}
            value={row.gridH}
            onChange={(event) => onChange({ gridH: Number(event.target.value) })}
            className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
          />
        </Field>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Unit" error={problemFor("unit")}>
          <input
            type="text"
            value={row.config.unit}
            placeholder="none"
            onChange={(event) => updateConfig({ unit: event.target.value })}
            className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
          />
        </Field>
        <Field label="Decimals" error={problemFor("decimals")}>
          <input
            type="text"
            inputMode="numeric"
            value={row.config.decimals}
            placeholder="not set"
            onChange={(event) => updateConfig({ decimals: event.target.value })}
            className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
          />
        </Field>
      </div>

      {row.widgetType === "radial_gauge" ? (
        <div className="space-y-2">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Minimum" error={problemFor("min")}>
              <input
                type="text"
                inputMode="decimal"
                value={row.config.min}
                onChange={(event) => updateConfig({ min: event.target.value })}
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
              />
            </Field>
            <Field label="Maximum" error={problemFor("max")}>
              <input
                type="text"
                inputMode="decimal"
                value={row.config.max}
                onChange={(event) => updateConfig({ max: event.target.value })}
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
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
                    className="w-24 rounded border border-gray-200 px-2 py-1 text-xs"
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
                    className="rounded border border-gray-200 px-2 py-1 text-xs"
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
                    className="rounded border border-red-200 px-2 py-0.5 text-[11px] font-semibold text-red-700"
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
                className="rounded border border-gray-200 px-2 py-1 text-[11px] font-semibold text-bms-ink"
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
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
            />
          </Field>
          <Field label="Fill tone">
            <select
              value={row.config.fillTone}
              onChange={(event) => updateConfig({ fillTone: event.target.value as WidgetConfigRow["fillTone"] })}
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
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
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
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
                  className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
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
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
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
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
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
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
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
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
              />
            </Field>
            <Field label="Y-axis label" error={problemFor("yAxisLabel")}>
              <input
                type="text"
                value={row.config.yAxisLabel}
                onChange={(event) => updateConfig({ yAxisLabel: event.target.value })}
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
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
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
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

      <Field label="Bound points" error={problemFor("points")}>
        <ul className="space-y-1">
          {row.points.map((point, index) => (
            <li
              key={`${point.pointId}-${index}`}
              className="flex items-center justify-between rounded border border-gray-100 px-2 py-1 text-xs"
            >
              <span>{point.label}</span>
              <button type="button" onClick={() => removePoint(index)} aria-label={`Remove ${point.label}`} className="text-red-700">
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
          <PointPicker organizationId={organizationId} onAdd={addPoint} />
        ) : null}
      </Field>

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
                className="flex items-center justify-between rounded border border-gray-100 px-2 py-1 text-xs"
              >
                <span>{metricCatalogLabel(source.catalogKey)}</span>
                <button
                  type="button"
                  onClick={() => removeSource(index)}
                  aria-label={`Remove ${metricCatalogLabel(source.catalogKey)}`}
                  className="text-red-700"
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
