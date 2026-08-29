/**
 * The Dashboards tab (`F3.1e`, ADR 0038 Amendment 4; ADR 0047).
 *
 * Wiring only. The rules are `src/lib/template-dashboard-form.ts`; the write
 * goes through Unit 6's `mergeTemplateContent`, whose third arm this tab is
 * the first caller of.
 *
 * ## This tab authors template content, not a live dashboard
 *
 * Nothing here draws a widget — `F3.1c` owns the four renderer components
 * (ADR 0047 decision 6). A view's `featured[]` and `widgets[]` are stored on
 * the template and instantiated onto real assets by `F3.2`, not built here.
 *
 * ## No rename
 *
 * View CRUD is add / edit / delete (ruled — §11 question 2 of the plan): a
 * new view's name is typed once, in the "Add a view" box, and an existing
 * row's name is never shown in an editable text box. Renaming would be
 * delete-plus-add on a record, and a half-applied rename drops a view.
 *
 * ## Always the complete record
 *
 * `buildDashboardsPayload` builds from every row in `rows`, never from the
 * one view currently open — `mergeTemplateContent` replaces the whole
 * `dashboards` key, so sending a subset would destroy every other stored
 * view (Unit 6's defect, one level down).
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { AdminAssetTemplateDto } from "@bms/shared";

import { updateAdminAssetTemplate } from "../../api/admin/asset-templates";
import { apiErrorMessage } from "../../lib/api-error-message";
import { mergeTemplateContent, unwritableContentKeys } from "../../lib/template-content-merge";
import {
  CHART_SERIES_OPTIONS,
  MAX_DASHBOARD_VIEWS,
  MAX_DASHBOARD_WIDGETS,
  MAX_FEATURED_POINTS,
  WIDGET_TONES,
  WIDGET_TYPES,
  WIDGET_TYPE_LABELS,
  blankDashboardView,
  blankWidgetRow,
  buildDashboardsPayload,
  dashboardFormErrors,
  dashboardRowsFrom,
  dashboardsHaveChanged,
  moveArrayItem,
  type DashboardFormProblem,
  type TemplateDashboardViewRow,
  type TemplateDashboardWidgetRow,
  type WidgetConfigRow,
} from "../../lib/template-dashboard-form";
import { Field } from "./field";

type DashboardsTabProps = {
  template: AdminAssetTemplateDto;
  editable: boolean;
  onSaved: (next: AdminAssetTemplateDto) => void;
  /** Tells the page whether leaving this tab would discard an edit. */
  onDirtyChange: (dirty: boolean) => void;
};

/** The stored section, read from the loose `content` record. */
function storedDashboards(template: AdminAssetTemplateDto): Record<string, unknown> | undefined {
  const section = template.content.dashboards;
  return section !== null && typeof section === "object"
    ? (section as Record<string, unknown>)
    : undefined;
}

export function DashboardsTab({ template, editable, onSaved, onDirtyChange }: DashboardsTabProps) {
  const [rows, setRows] = useState<TemplateDashboardViewRow[]>(() =>
    dashboardRowsFrom(storedDashboards(template)),
  );
  const [error, setError] = useState<string | null>(null);
  const [newViewName, setNewViewName] = useState("");
  const [activeIndex, setActiveIndex] = useState<number | null>(rows.length > 0 ? 0 : null);

  // Keyed on the row id and the lifecycle status — see `details-tab.tsx` and
  // `kpis-tab.tsx:81-86`.
  useEffect(() => {
    const next = dashboardRowsFrom(storedDashboards(template));
    setRows(next);
    setError(null);
    setNewViewName("");
    setActiveIndex(next.length > 0 ? 0 : null);
  }, [template.id, template.status]);

  const declaredPointKeys = template.points.map((point) => point.pointKey);
  const problems = dashboardFormErrors(rows, declaredPointKeys);
  const blockedKeys = unwritableContentKeys(template.content);
  const changed = dashboardsHaveChanged(rows, storedDashboards(template));

  // The same comparison Save already uses, reported up so the page can guard
  // a tab switch. The cleanup reports clean on unmount, so switching away
  // cannot leave the page holding this tab's `true`. The tab-guard's ordered
  // pair count (`template-tab-guard.spec.ts`) moved to 30 the instant this
  // tab joined the registry, whether or not this call exists — it proves
  // nothing about this tab. This call, and `dashboardsHaveChanged`'s own
  // spec, are the two real proofs.
  useEffect(() => {
    onDirtyChange(changed);
    return () => onDirtyChange(false);
  }, [changed, onDirtyChange]);

  const blocked = problems.length > 0 || blockedKeys.length > 0;

  const saveM = useMutation({
    mutationFn: () =>
      updateAdminAssetTemplate(template.id, {
        // The whole content object, not a partial — every other section is
        // carried byte for byte, and every other view in this section is too.
        content: mergeTemplateContent(template.content, {
          section: "dashboards",
          value: buildDashboardsPayload(rows),
        }),
      }),
    onSuccess: (next) => {
      setError(null);
      onSaved(next);
    },
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });

  function updateView(index: number, patch: Partial<TemplateDashboardViewRow>) {
    setRows((current) =>
      current.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)),
    );
  }

  function addView() {
    const name = newViewName.trim();
    if (name === "") {
      return;
    }
    setRows((current) => {
      const next = [...current, { ...blankDashboardView(), name }];
      setActiveIndex(next.length - 1);
      return next;
    });
    setNewViewName("");
  }

  function removeView(index: number) {
    setRows((current) => current.filter((_, position) => position !== index));
    setActiveIndex((current) => {
      if (current === null || index === current) {
        return null;
      }
      return index < current ? current - 1 : current;
    });
  }

  const activeView = activeIndex !== null ? rows[activeIndex] : undefined;
  const viewProblems = (viewIndex: number) =>
    problems.filter((problem) => problem.view === viewIndex);
  const sectionProblems = problems.filter((problem) => problem.view === null);

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>
      ) : null}

      {blockedKeys.length > 0 ? (
        <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Saving dashboards is blocked: this template holds content that cannot be written back.
          The banner above lists the keys. Editing here is safe — nothing is sent until they are
          removed.
        </p>
      ) : null}

      {sectionProblems.map((problem) => (
        <p
          key={problem.message}
          className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800"
        >
          {problem.message}
        </p>
      ))}

      <div className="flex flex-wrap gap-4">
        <div className="w-48 shrink-0 space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-bms-muted">
            Views
          </span>
          {rows.length === 0 ? (
            <p className="rounded border border-dashed border-gray-300 p-3 text-xs text-bms-muted">
              This template has no dashboard views yet.
            </p>
          ) : null}
          <ul className="space-y-1">
            {rows.map((view, index) => {
              const rowHasProblem = viewProblems(index).length > 0;
              return (
                <li key={index} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setActiveIndex(index)}
                    className={`flex-1 truncate rounded border px-2 py-1 text-left text-xs ${
                      index === activeIndex
                        ? "border-bms-green bg-bms-green/10 font-semibold"
                        : "border-gray-200"
                    } ${rowHasProblem ? "text-red-700" : ""}`}
                  >
                    {view.name.trim() === "" ? "(unnamed view)" : view.name}
                  </button>
                  {editable ? (
                    <button
                      type="button"
                      onClick={() => removeView(index)}
                      aria-label={`Delete ${view.name || "this view"}`}
                      className="rounded border border-red-200 px-1.5 py-1 text-[11px] font-semibold text-red-700"
                    >
                      ×
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {editable ? (
            <div className="space-y-1 border-t border-gray-200 pt-2">
              <input
                type="text"
                value={newViewName}
                placeholder="New view name"
                disabled={rows.length >= MAX_DASHBOARD_VIEWS}
                onChange={(event) => setNewViewName(event.target.value)}
                className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
              />
              <button
                type="button"
                disabled={newViewName.trim() === "" || rows.length >= MAX_DASHBOARD_VIEWS}
                onClick={addView}
                className="w-full rounded border border-gray-200 px-2 py-1 text-xs font-semibold text-bms-ink disabled:opacity-60"
              >
                Add a view
              </button>
            </div>
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          {activeView && activeIndex !== null ? (
            <DashboardViewEditor
              view={activeView}
              problems={viewProblems(activeIndex)}
              declaredPointKeys={declaredPointKeys}
              editable={editable}
              onChange={(patch) => updateView(activeIndex, patch)}
            />
          ) : (
            <p className="rounded border border-dashed border-gray-300 p-4 text-xs text-bms-muted">
              {rows.length === 0
                ? "Add a view to start authoring a dashboard."
                : "Choose a view on the left."}
            </p>
          )}
        </div>
      </div>

      {editable ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 pt-3">
          <button
            type="button"
            disabled={blocked || !changed || saveM.isPending}
            onClick={() => saveM.mutate()}
            className="rounded bg-bms-green px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          >
            {saveM.isPending ? "Saving…" : "Save dashboards"}
          </button>
          <span className="text-[11px] text-bms-muted">
            {blockedKeys.length > 0
              ? "Blocked by unwritable content."
              : problems.length > 0
                ? "Fix the problems above to save."
                : changed
                  ? "Sends every view; nothing outside this section is touched."
                  : "No changes yet."}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function DashboardViewEditor({
  view,
  problems,
  declaredPointKeys,
  editable,
  onChange,
}: {
  view: TemplateDashboardViewRow;
  problems: DashboardFormProblem[];
  declaredPointKeys: string[];
  editable: boolean;
  onChange: (patch: Partial<TemplateDashboardViewRow>) => void;
}) {
  const problemFor = (field: string) => problems.find((problem) => problem.field === field)?.message;

  function addFeatured(key: string) {
    if (key === "" || view.featured.includes(key)) {
      return;
    }
    onChange({ featured: [...view.featured, key] });
  }

  function removeFeatured(index: number) {
    onChange({ featured: view.featured.filter((_, position) => position !== index) });
  }

  function moveFeatured(index: number, direction: -1 | 1) {
    onChange({ featured: moveArrayItem(view.featured, index, direction) });
  }

  function updateWidget(index: number, patch: Partial<TemplateDashboardWidgetRow>) {
    onChange({
      widgets: view.widgets.map((widget, position) =>
        position === index ? { ...widget, ...patch } : widget,
      ),
    });
  }

  function addWidget(widgetType: (typeof WIDGET_TYPES)[number]) {
    onChange({ widgets: [...view.widgets, blankWidgetRow(widgetType)] });
  }

  function removeWidget(index: number) {
    onChange({ widgets: view.widgets.filter((_, position) => position !== index) });
  }

  const remainingPointKeys = declaredPointKeys.filter((key) => !view.featured.includes(key));

  return (
    <div className="space-y-4">
      <section className="rounded border border-gray-200 p-3">
        <Field label="Featured points" error={problemFor("featured")}>
          <div className="space-y-1">
            {view.featured.length === 0 ? (
              <p className="text-[11px] text-bms-muted">
                No points featured yet — a view needs at least one.
              </p>
            ) : null}
            <ul className="space-y-1">
              {view.featured.map((key, index) => (
                <li key={key} className="flex items-center gap-1 text-xs">
                  <span className="flex-1">{key}</span>
                  {editable ? (
                    <>
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => moveFeatured(index, -1)}
                        className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] disabled:opacity-40"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={index === view.featured.length - 1}
                        onClick={() => moveFeatured(index, 1)}
                        className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] disabled:opacity-40"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => removeFeatured(index)}
                        className="rounded border border-red-200 px-1.5 py-0.5 text-[11px] font-semibold text-red-700"
                      >
                        Remove
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
            {editable && view.featured.length < MAX_FEATURED_POINTS ? (
              <select
                value=""
                onChange={(event) => addFeatured(event.target.value)}
                className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
              >
                <option value="">Feature a point…</option>
                {remainingPointKeys.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </Field>
      </section>

      <section className="space-y-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-bms-muted">
          Widgets
        </span>
        {view.widgets.length === 0 ? (
          <p className="rounded border border-dashed border-gray-300 p-3 text-xs text-bms-muted">
            This view has no widgets yet.
          </p>
        ) : null}
        {view.widgets.map((widget, index) => (
          <WidgetEditor
            key={index}
            widget={widget}
            problems={problems.filter((problem) => problem.widget === index)}
            declaredPointKeys={declaredPointKeys}
            editable={editable}
            onChange={(patch) => updateWidget(index, patch)}
            onRemove={() => removeWidget(index)}
          />
        ))}
        {editable && view.widgets.length < MAX_DASHBOARD_WIDGETS ? (
          <div className="flex flex-wrap items-center gap-2">
            {WIDGET_TYPES.map((widgetType) => (
              <button
                key={widgetType}
                type="button"
                onClick={() => addWidget(widgetType)}
                className="rounded border border-gray-200 px-3 py-1.5 text-xs font-semibold text-bms-ink"
              >
                Add {WIDGET_TYPE_LABELS[widgetType]}
              </button>
            ))}
          </div>
        ) : null}
        {problemFor("widgets") ? (
          <p className="text-[11px] text-red-700">{problemFor("widgets")}</p>
        ) : null}
      </section>
    </div>
  );
}

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
