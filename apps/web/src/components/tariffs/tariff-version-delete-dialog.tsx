import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { TariffVersionDto } from "@bms/shared/contracts";

import { deleteTariffVersion } from "../../api/tariffs";
import { apiErrorMessage } from "../../lib/api-error-message";
import { monthLabel } from "../../lib/tariff-labels";

/**
 * `F4.365` U9 (ADR 0134 decision 8, Amendment 1) — the dialog that deletes an organization's own
 * tariff version not yet in force. Its own file under AGENTS.md §4.2 (one exported component per
 * file); the form that writes a version is `tariff-version-form.tsx`.
 */

const fieldClass = "mt-1 w-full surface-field px-3 py-2 text-sm";
const labelClass = "block text-xs font-semibold text-ink-muted";

type TariffVersionDeleteDialogProps = {
  version: TariffVersionDto;
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
};

/** Deletes a version not yet in force; the reason (3–500 characters) is the audit row's. */
export function TariffVersionDeleteDialog({ version, onClose, onDeleted }: TariffVersionDeleteDialogProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (why: string) => deleteTariffVersion(version.id, why),
    onSuccess: onDeleted,
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });
  const title = `Delete version from ${monthLabel(version.effectiveFrom)}`;

  function submit(): void {
    const why = reason.trim();
    if (why.length < 3 || why.length > 500) {
      setError("A reason of 3 to 500 characters is required.");
      return;
    }
    deleteMutation.mutate(why);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4">
      <div role="dialog" aria-label={title} className="w-full max-w-md surface-dialog p-4">
        <h2 className="font-condensed text-lg font-bold">{title}</h2>
        <p className="mt-1 text-xs text-ink-muted">
          <code>{version.key}</code> — the months it covered fall back to the version before it.
        </p>
        <label className={`${labelClass} mt-3`}>
          Reason
          <textarea
            className={fieldClass}
            rows={2}
            value={reason}
            required
            onChange={(e) => {
              setError(null);
              setReason(e.target.value);
            }}
          />
        </label>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-critical-ink">
            {error}
          </p>
        ) : null}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="px-3 py-2 text-xs font-semibold text-ink-muted" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="surface-button px-3 py-2 text-xs font-semibold text-critical-ink"
            disabled={deleteMutation.isPending}
            aria-busy={deleteMutation.isPending}
            onClick={submit}
          >
            {deleteMutation.isPending ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
