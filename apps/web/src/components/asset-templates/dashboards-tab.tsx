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
  MAX_DASHBOARD_VIEWS,
  blankDashboardView,
  buildDashboardsPayload,
  dashboardFormErrors,
  dashboardRowsFrom,
  dashboardsHaveChanged,
  type TemplateDashboardViewRow,
} from "../../lib/template-dashboard-form";
import { DashboardViewEditor } from "./dashboard-view-editor";

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
