import {
  MAX_DASHBOARD_WIDGETS,
  MAX_FEATURED_POINTS,
  WIDGET_TYPES,
  WIDGET_TYPE_LABELS,
  blankWidgetRow,
  moveArrayItem,
  type DashboardFormProblem,
  type TemplateDashboardViewRow,
  type TemplateDashboardWidgetRow,
} from "../../lib/template-dashboard-form";
import { WidgetEditor } from "./dashboard-widget-editor";
import { Field } from "./field";

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
      {/* The view **name** problems — blank, too long, an unsafe key, or a
          duplicate. `dashboardFormErrors` has always raised these four and they
          were rendered nowhere, which left Save greyed out with "Fix the
          problems above to save." and nothing above to fix. The only recourse
          was deleting the row, which nothing said. Found by the correctness
          review of `F3.1e`, not by the browser pass — a duplicate name is not
          something a first pass thinks to type.

          The duplicate case is the one that matters beyond the dead end:
          `buildDashboardsPayload` writes `payload[name] = view`, so two rows
          sharing a name collapse to one and the second overwrites the first.
          Save being blocked is the only thing between that and a destroyed
          stored view, so the block must be legible. */}
      {problemFor("name") ? (
        <p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          {problemFor("name")}
        </p>
      ) : null}
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

export { DashboardViewEditor };
