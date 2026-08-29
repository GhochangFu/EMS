import {
  CHART_SERIES_OPTIONS,
  WIDGET_TONES,
  WIDGET_TYPE_LABELS,
  type DashboardFormProblem,
  type TemplateDashboardWidgetRow,
  type WidgetConfigRow,
} from "../../lib/template-dashboard-form";
import { Field } from "./field";

function WidgetEditor({
  widget,
  problems,
  declaredPointKeys,
  editable,
  onChange,
  onRemove,
}: {
  widget: TemplateDashboardWidgetRow;
  problems: DashboardFormProblem[];
  declaredPointKeys: string[];
  editable: boolean;
  onChange: (patch: Partial<TemplateDashboardWidgetRow>) => void;
  onRemove: () => void;
}) {
  const problemFor = (field: string) => problems.find((problem) => problem.field === field)?.message;

  function updateConfig(patch: Partial<WidgetConfigRow>) {
    onChange({ config: { ...widget.config, ...patch } });
  }

  return (
    <section className="rounded border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-bms-muted">
          {WIDGET_TYPE_LABELS[widget.widgetType]}
        </span>
        {editable ? (
          <button
            type="button"
            onClick={onRemove}
            className="rounded border border-red-200 px-2 py-0.5 text-[11px] font-semibold text-red-700"
          >
            Remove
          </button>
        ) : null}
      </div>

      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <Field label="Title" error={problemFor("title")}>
          <input
            type="text"
            value={widget.title}
            disabled={!editable}
            placeholder="optional"
            onChange={(event) => onChange({ title: event.target.value })}
            className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
          />
        </Field>
        <Field label="Points bound" error={problemFor("pointKeys")}>
          <select
            multiple
            size={Math.min(5, Math.max(2, declaredPointKeys.length))}
            value={widget.pointKeys}
            disabled={!editable}
            onChange={(event) =>
              onChange({ pointKeys: [...event.target.selectedOptions].map((option) => option.value) })
            }
            className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
          >
            {declaredPointKeys.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-2 grid grid-cols-4 gap-2">
        <Field label="gridX" error={problemFor("gridX")}>
          <input
            type="number"
            value={widget.gridX}
            disabled={!editable}
            onChange={(event) => onChange({ gridX: Number(event.target.value) })}
            className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
          />
        </Field>
        <Field label="gridY" error={problemFor("gridY")}>
          <input
            type="number"
            value={widget.gridY}
            disabled={!editable}
            onChange={(event) => onChange({ gridY: Number(event.target.value) })}
            className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
          />
        </Field>
        <Field label="gridW" error={problemFor("gridW")}>
          <input
            type="number"
            value={widget.gridW}
            disabled={!editable}
            onChange={(event) => onChange({ gridW: Number(event.target.value) })}
            className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
          />
        </Field>
        <Field label="gridH" error={problemFor("gridH")}>
          <input
            type="number"
            value={widget.gridH}
            disabled={!editable}
            onChange={(event) => onChange({ gridH: Number(event.target.value) })}
            className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
          />
        </Field>
      </div>

      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <Field label="Unit" error={problemFor("unit")}>
          <input
            type="text"
            value={widget.config.unit}
            disabled={!editable}
            placeholder="none"
            onChange={(event) => updateConfig({ unit: event.target.value })}
            className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
          />
        </Field>
        <Field label="Decimals" error={problemFor("decimals")}>
          <input
            type="text"
            inputMode="numeric"
            value={widget.config.decimals}
            disabled={!editable}
            placeholder="not set"
            onChange={(event) => updateConfig({ decimals: event.target.value })}
            className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
          />
        </Field>
      </div>

      {widget.widgetType === "radial_gauge" ? (
        <div className="mt-2 space-y-2">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Minimum" error={problemFor("min")}>
              <input
                type="text"
                inputMode="decimal"
                value={widget.config.min}
                disabled={!editable}
                onChange={(event) => updateConfig({ min: event.target.value })}
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
              />
            </Field>
            <Field label="Maximum" error={problemFor("max")}>
              <input
                type="text"
                inputMode="decimal"
                value={widget.config.max}
                disabled={!editable}
                onChange={(event) => updateConfig({ max: event.target.value })}
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
              />
            </Field>
          </div>
          <Field label="Threshold bands" error={problemFor("thresholds")}>
            <div className="space-y-1">
              {widget.config.thresholds.map((threshold, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={threshold.value}
                    disabled={!editable}
                    placeholder="value"
                    onChange={(event) =>
                      updateConfig({
                        thresholds: widget.config.thresholds.map((entry, position) =>
                          position === index ? { ...entry, value: event.target.value } : entry,
                        ),
                      })
                    }
                    className="w-24 rounded border border-gray-200 px-2 py-1 text-xs"
                  />
                  <select
                    value={threshold.tone}
                    disabled={!editable}
                    onChange={(event) =>
                      updateConfig({
                        thresholds: widget.config.thresholds.map((entry, position) =>
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
                  {editable ? (
                    <button
                      type="button"
                      onClick={() =>
                        updateConfig({
                          thresholds: widget.config.thresholds.filter((_, position) => position !== index),
                        })
                      }
                      className="rounded border border-red-200 px-2 py-0.5 text-[11px] font-semibold text-red-700"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              ))}
              {editable ? (
                <button
                  type="button"
                  onClick={() =>
                    updateConfig({
                      thresholds: [...widget.config.thresholds, { value: "", tone: "ok" }],
                    })
                  }
                  className="rounded border border-gray-200 px-2 py-1 text-[11px] font-semibold text-bms-ink"
                >
                  Add a threshold band
                </button>
              ) : null}
            </div>
          </Field>
        </div>
      ) : null}

      {widget.widgetType === "tank_level" ? (
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          <Field label="Full scale" error={problemFor("fullScale")}>
            <input
              type="text"
              inputMode="decimal"
              value={widget.config.fullScale}
              disabled={!editable}
              onChange={(event) => updateConfig({ fullScale: event.target.value })}
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
            />
          </Field>
          <Field label="Fill tone">
            <select
              value={widget.config.fillTone}
              disabled={!editable}
              onChange={(event) =>
                updateConfig({ fillTone: event.target.value as WidgetConfigRow["fillTone"] })
              }
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

      {widget.widgetType === "value_tile" ? (
        <label className="mt-2 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={widget.config.abbreviate}
            disabled={!editable}
            onChange={(event) => updateConfig({ abbreviate: event.target.checked })}
          />
          Abbreviate large values (1.2k, 3.4M)
        </label>
      ) : null}

      {widget.widgetType === "chart" ? (
        <div className="mt-2 space-y-2">
          <Field label="Chart kind" error={problemFor("series")}>
            <select
              value={widget.config.series}
              disabled={!editable}
              onChange={(event) =>
                updateConfig({ series: event.target.value as WidgetConfigRow["series"] })
              }
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
            >
              {CHART_SERIES_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Window (minutes)" error={problemFor("windowMinutes")}>
              <input
                type="text"
                inputMode="numeric"
                value={widget.config.windowMinutes}
                disabled={!editable}
                placeholder="1440 (default)"
                onChange={(event) => updateConfig({ windowMinutes: event.target.value })}
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
              />
            </Field>
            <Field label="Y-axis label" error={problemFor("yAxisLabel")}>
              <input
                type="text"
                value={widget.config.yAxisLabel}
                disabled={!editable}
                onChange={(event) => updateConfig({ yAxisLabel: event.target.value })}
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={widget.config.stacked}
              disabled={!editable}
              onChange={(event) => updateConfig({ stacked: event.target.checked })}
            />
            Stack series
          </label>
        </div>
      ) : null}
    </section>
  );
}

export { WidgetEditor };
