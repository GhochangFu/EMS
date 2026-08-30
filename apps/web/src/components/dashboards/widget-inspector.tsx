import { DASHBOARD_GRID } from "@bms/shared";
import type { AdminAssetPointDto, WidgetPointRole } from "@bms/shared";

import type { DashboardBuilderProblem, DashboardWidgetRow } from "../../lib/dashboard-builder-form";
import { WIDGET_CATALOG } from "../../lib/widget-catalog";
import { MAX_WIDGET_TITLE_LENGTH, WIDGET_TONES, type WidgetConfigRow } from "../../lib/widget-config-form";
import { Field } from "../asset-templates/field";
import { ChartSeriesPicker } from "./chart-series-picker";
import { PointPicker } from "./point-picker";

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
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={row.config.abbreviate}
            onChange={(event) => updateConfig({ abbreviate: event.target.checked })}
          />
          Abbreviate large values (1.2k, 3.4M)
        </label>
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
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={row.config.stacked}
              onChange={(event) => updateConfig({ stacked: event.target.checked })}
            />
            Stack series
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
        {row.points.length < cardinality.max ? (
          <PointPicker organizationId={organizationId} onAdd={addPoint} />
        ) : null}
      </Field>
    </section>
  );
}
