/**
 * The Points tab (`F2.5`, ADR 0038 Unit 9b).
 *
 * Wiring only. Every rule — what survives a round trip, what a kind change
 * clears, which formulas an edit just broke — lives in
 * `src/lib/template-points-grid.ts` with its spec, because a `.tsx` is
 * unreachable by this repository's tests and invisible to the coverage gate.
 *
 * `pointKey` is a `<select>` over this organization's **active** point-key
 * catalog, not free text: `assertPointKeysActive` rejects anything else with a
 * 400, so a text box would be a way to guarantee failures. A key that was
 * deactivated after this template was written stays selectable and labelled,
 * so an existing point does not silently change to whatever the list offers
 * first.
 *
 * `sortOrder` is a number input. ADR 0038 decision 2 makes it the dashboard
 * ordering control, and there is no section editor and no drag-and-drop.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { AdminAssetTemplateDto } from "@bms/shared";

import { updateAdminAssetTemplate } from "../../api/admin/asset-templates";
import { fetchAdminPointKeys } from "../../api/admin/point-keys";
import {
  MAX_TEMPLATE_POINTS,
  blankPointRow,
  buildPointsPayload,
  pointGridErrors,
  pointRowsFrom,
  pointsHaveChanged,
  setPointKind,
  type TemplatePointRow,
} from "../../lib/template-points-grid";

type PointsTabProps = {
  template: AdminAssetTemplateDto;
  editable: boolean;
  onSaved: (next: AdminAssetTemplateDto) => void;
};

export function PointsTab({ template, editable, onSaved }: PointsTabProps) {
  const [rows, setRows] = useState<TemplatePointRow[]>(() => pointRowsFrom(template));
  const [error, setError] = useState<string | null>(null);

  // Keyed on the row id alone, for the reason `details-tab.tsx` records: a
  // refetch on window focus or after a lifecycle action would otherwise discard
  // an unsaved grid with no message.
  useEffect(() => {
    setRows(pointRowsFrom(template));
    setError(null);
  }, [template.id]);

  const catalogQ = useQuery({
    queryKey: ["admin", "point-keys", "true", template.organizationId],
    queryFn: () => fetchAdminPointKeys("true", template.organizationId),
  });
  const catalog = catalogQ.data?.items ?? [];

  const problems = pointGridErrors(rows);
  const changed = pointsHaveChanged(rows, template);

  const saveM = useMutation({
    mutationFn: () => updateAdminAssetTemplate(template.id, { points: buildPointsPayload(rows) }),
    onSuccess: (next) => {
      setError(null);
      onSaved(next);
    },
    // The service's own sentence — a key that went inactive between load and
    // save names itself here.
    onError: (cause: Error) => setError(cause.message),
  });

  function update(index: number, patch: Partial<TemplatePointRow>) {
    setRows((current) =>
      current.map((row, position) => (position === index ? { ...row, ...patch } : row)),
    );
  }

  const gridProblems = problems.filter((problem) => problem.row === null);

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>
      ) : null}

      {gridProblems.map((problem) => (
        <p
          key={problem.message}
          className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800"
        >
          {problem.message}
        </p>
      ))}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[64rem] text-left text-xs">
          <thead className="text-[11px] uppercase tracking-wide text-bms-muted">
            <tr>
              <th className="py-1 pr-2">Point key</th>
              <th className="py-1 pr-2">Label</th>
              <th className="py-1 pr-2">Unit</th>
              <th className="py-1 pr-2">Kind</th>
              <th className="py-1 pr-2">Source key pattern</th>
              <th className="py-1 pr-2">Required</th>
              <th className="py-1 pr-2">Order</th>
              {editable ? <th className="py-1" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const rowProblems = problems.filter((problem) => problem.row === index);
              const problemFor = (field: string) =>
                rowProblems.find((problem) => problem.field === field);
              const keyIsKnown = catalog.some((entry) => entry.code === row.pointKey);

              return (
                <tr key={index} className="border-t border-gray-100 align-top">
                  <td className="py-1.5 pr-2">
                    <select
                      value={row.pointKey}
                      disabled={!editable}
                      onChange={(event) => update(index, { pointKey: event.target.value })}
                      className={cellClass(!editable, problemFor("pointKey"))}
                    >
                      <option value="">Select a point key…</option>
                      {/* Deactivated after this template was written. Kept so
                          the row shows what it holds rather than snapping to
                          another key on the next save. */}
                      {!keyIsKnown && row.pointKey !== "" ? (
                        <option value={row.pointKey}>{row.pointKey} (inactive)</option>
                      ) : null}
                      {catalog.map((entry) => (
                        <option key={entry.code} value={entry.code}>
                          {entry.code}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      type="text"
                      value={row.label}
                      disabled={!editable}
                      placeholder="catalog default"
                      onChange={(event) => update(index, { label: event.target.value })}
                      className={cellClass(!editable, undefined)}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      type="text"
                      value={row.unit}
                      disabled={!editable}
                      placeholder="catalog default"
                      onChange={(event) => update(index, { unit: event.target.value })}
                      className={cellClass(!editable, undefined)}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <select
                      value={row.kind}
                      disabled={!editable}
                      // Through `setPointKind`, never a direct field write: the
                      // clearing rule is what keeps a formerly-derived point
                      // from carrying a formula the schema then refuses.
                      onChange={(event) =>
                        setRows((current) =>
                          current.map((entry, position) =>
                            position === index
                              ? setPointKind(entry, event.target.value as TemplatePointRow["kind"])
                              : entry,
                          ),
                        )
                      }
                      className={cellClass(!editable, problemFor("kind"))}
                    >
                      <option value="measured">measured</option>
                      <option value="derived">derived</option>
                    </select>
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      type="text"
                      value={row.sourceDataKeyPattern}
                      disabled={!editable || row.kind === "derived"}
                      placeholder={row.kind === "derived" ? "computed" : "CH{unit}_CHW_SUPPLY_T"}
                      onChange={(event) =>
                        update(index, { sourceDataKeyPattern: event.target.value })
                      }
                      className={cellClass(!editable || row.kind === "derived", undefined)}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      type="checkbox"
                      checked={row.required}
                      disabled={!editable}
                      onChange={(event) => update(index, { required: event.target.checked })}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      type="number"
                      min={0}
                      value={row.sortOrder}
                      disabled={!editable}
                      onChange={(event) =>
                        update(index, { sortOrder: Number(event.target.value) || 0 })
                      }
                      className={`${cellClass(!editable, undefined)} w-16`}
                    />
                  </td>
                  {editable ? (
                    <td className="py-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setRows((current) => current.filter((_, position) => position !== index))
                        }
                        className="rounded border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-700"
                      >
                        Remove
                      </button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-4 text-center text-bms-muted">
                  This template declares no points yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Row problems below the table rather than inside a cell: a message
          naming another row ("already used by row 1") has to be readable
          alongside both. */}
      {problems.some((problem) => problem.row !== null) ? (
        <ul className="space-y-1 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {problems
            .filter((problem) => problem.row !== null)
            .map((problem, index) => (
              <li key={`${problem.row}-${problem.field}-${index}`}>
                Row {(problem.row ?? 0) + 1}: {problem.message}
              </li>
            ))}
        </ul>
      ) : null}

      {editable ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={rows.length >= MAX_TEMPLATE_POINTS}
            onClick={() => setRows((current) => [...current, blankPointRow(current)])}
            className="rounded border border-gray-200 px-3 py-1.5 text-xs font-semibold text-bms-ink disabled:opacity-60"
          >
            Add a point
          </button>
          <button
            type="button"
            disabled={problems.length > 0 || !changed || saveM.isPending}
            onClick={() => saveM.mutate()}
            className="rounded bg-bms-green px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          >
            {saveM.isPending ? "Saving…" : "Save points"}
          </button>
          <span className="text-[11px] text-bms-muted">
            {problems.length > 0
              ? "Fix the problems above to save."
              : changed
                ? `Sends all ${rows.length} points — the server replaces the set.`
                : "No changes yet."}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function cellClass(disabled: boolean, problem: { message: string } | undefined): string {
  const tone = problem ? "border-red-300 bg-red-50" : "border-gray-200";
  return `w-full rounded border px-2 py-1 text-xs ${tone} ${
    disabled ? "bg-gray-50 text-bms-muted" : ""
  }`;
}
