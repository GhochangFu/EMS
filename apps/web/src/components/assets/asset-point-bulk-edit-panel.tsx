import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { QUALITY_POLICIES } from "@bms/shared";
import type { QualityPolicy } from "@bms/shared";

import { bulkUpdateAdminAssetPoints } from "../../api/admin/asset-points";
import { apiErrorMessage } from "../../lib/api-error-message";
import {
  EMPTY_BULK_EDIT_DRAFT,
  MAX_ASSET_POINT_BULK_IDS,
  bulkEditProblems,
  draftToPatch,
  type BulkEditDraft,
} from "../../lib/asset-point-bulk-edit";

/**
 * `F2.7` / ADR 0056 decision 8 — one patch over the selected rows, all or
 * nothing.
 *
 * Every field carries a tick box beside its control, and the control is
 * disabled until the box is ticked. That is the surface of the three-valued
 * rule `lib/asset-point-bulk-edit.ts` states: unticked leaves every selected
 * row alone, ticked and empty clears the column back to the template default,
 * ticked with a value writes it. Without the box there would be no way to tell
 * "leave the unit" from "clear the unit" in an empty text box.
 *
 * The panel refuses what it can see (nothing ticked, a zero multiplier, an
 * inverted pair) and sends the rest. The refusals only the server can make —
 * a row whose *inherited* bound the patch inverts, a computed row, a selection
 * spanning two organizations — come back as its own sentence and are shown as
 * they arrive.
 */
type AssetPointBulkEditPanelProps = {
  /** The selected `asset_points` ids, in the order the table shows them. */
  ids: readonly string[];
  /** Called after the write, so the page can clear its selection and close the panel. */
  onApplied: () => void;
  onCancel: () => void;
};

/**
 * The five typed fields, in the order the panel lays them out.
 *
 * **The four numeric ones are `type="text"` with `inputMode="decimal"`, not
 * `type="number"`.** A `type="number"` box reports an entry the browser cannot
 * parse as `""` while still showing it, and `""` on a ticked field is the
 * explicit clear — so `12e` would have cleared the column on every selected row
 * while the box on screen read `12e`. As text the value survives,
 * `bulkEditProblems` reports "is not a number", and Apply stays unavailable.
 * The single-row form keeps `type="number"`: there the same slip clears one
 * row, in front of the person who typed it.
 */
const TYPED_FIELDS = [
  { field: "unit", label: "unit", numeric: false },
  { field: "scaleMultiplier", label: "scale multiplier", numeric: true },
  { field: "scaleOffset", label: "scale offset", numeric: true },
  { field: "engMin", label: "engineering minimum", numeric: true },
  { field: "engMax", label: "engineering maximum", numeric: true },
] as const;

export function AssetPointBulkEditPanel({ ids, onApplied, onCancel }: AssetPointBulkEditPanelProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<BulkEditDraft>(EMPTY_BULK_EDIT_DRAFT);
  const [error, setError] = useState<string | null>(null);

  const problems = bulkEditProblems(draft);
  const overTheCap = ids.length > MAX_ASSET_POINT_BULK_IDS;

  const applyMutation = useMutation({
    mutationFn: async () => bulkUpdateAdminAssetPoints({ ids, patch: draftToPatch(draft) }),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "asset-points"] });
      onApplied();
    },
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });

  function setField<K extends keyof BulkEditDraft>(field: K, next: BulkEditDraft[K]): void {
    setDraft((current) => ({ ...current, [field]: next }));
  }

  return (
    <div className="space-y-3 rounded border border-bms-green/30 bg-bms-green/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-condensed text-sm font-bold text-bms-ink">
          Edit {ids.length === 1 ? "1 selected row" : `${ids.length} selected rows`}
        </h3>
        <button type="button" className="text-xs font-semibold text-bms-muted" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="text-xs text-bms-muted">
        Tick a field to change it on every selected row. A ticked field left empty clears the stored
        value, so the row follows its template default again. Nothing is written unless every
        selected row accepts the change.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        {TYPED_FIELDS.map(({ field, label, numeric }) => (
          <label key={field} className="flex items-center gap-2 text-xs font-semibold text-bms-muted">
            <input
              type="checkbox"
              aria-label={`Change ${label}`}
              checked={draft[field].set}
              onChange={(event) => setField(field, { ...draft[field], set: event.target.checked })}
            />
            <span className="w-40 capitalize">{label}</span>
            <input
              type="text"
              inputMode={numeric ? "decimal" : "text"}
              aria-label={`New ${label}`}
              disabled={!draft[field].set}
              value={draft[field].value}
              className="w-full rounded border px-2 py-1 text-sm disabled:bg-gray-100"
              onChange={(event) => setField(field, { set: true, value: event.target.value })}
            />
          </label>
        ))}

        <label className="flex items-center gap-2 text-xs font-semibold text-bms-muted">
          <input
            type="checkbox"
            aria-label="Change quality policy"
            checked={draft.qualityPolicy.set}
            onChange={(event) =>
              setField("qualityPolicy", { ...draft.qualityPolicy, set: event.target.checked })
            }
          />
          <span className="w-40">Quality policy</span>
          <select
            aria-label="New quality policy"
            disabled={!draft.qualityPolicy.set}
            value={draft.qualityPolicy.value}
            className="w-full rounded border px-2 py-1 text-sm disabled:bg-gray-100"
            onChange={(event) =>
              setField("qualityPolicy", {
                set: true,
                value: event.target.value as QualityPolicy | "",
              })
            }
          >
            {/* Empty is the clear, and the two policies are the shared
                vocabulary — never a second list of options (§4.8). */}
            <option value="">Follow the template</option>
            {QUALITY_POLICIES.map((policy) => (
              <option key={policy} value={policy}>
                {policy}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs font-semibold text-bms-muted">
          <input
            type="checkbox"
            aria-label="Change status"
            checked={draft.active.set}
            onChange={(event) => setField("active", { ...draft.active, set: event.target.checked })}
          />
          <span className="w-40">Status</span>
          <select
            aria-label="New status"
            disabled={!draft.active.set}
            value={draft.active.value ? "active" : "inactive"}
            className="w-full rounded border px-2 py-1 text-sm disabled:bg-gray-100"
            onChange={(event) => setField("active", { set: true, value: event.target.value === "active" })}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
      </div>

      {problems.map((problem) => (
        <p key={problem} className="text-xs text-red-700">
          {problem}
        </p>
      ))}
      {overTheCap ? (
        <p className="text-xs text-red-700">
          {ids.length} rows are selected and the cap is {MAX_ASSET_POINT_BULK_IDS} — narrow the
          filter, or clear part of the selection.
        </p>
      ) : null}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}

      <button
        type="button"
        className="rounded bg-bms-green px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        disabled={problems.length > 0 || overTheCap || ids.length === 0 || applyMutation.isPending}
        onClick={() => applyMutation.mutate()}
      >
        {applyMutation.isPending
          ? "Applying…"
          : `Apply to ${ids.length} ${ids.length === 1 ? "row" : "rows"}`}
      </button>
    </div>
  );
}
