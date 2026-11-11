import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import type { UserRole, WorkOrderListItem } from "@bms/shared";

import { rejectWorkOrder } from "../../api/work-orders";
import { canApproveWorkOrders } from "../../lib/admin-access";
import { apiErrorMessage } from "../../lib/api-error-message";
import { fieldClass, labelClass } from "../admin/admin-wizard-frame";

export type WorkOrderRejectFormProps = {
  row: WorkOrderListItem;
  role: UserRole;
  onDone: (row: WorkOrderListItem) => void | Promise<void>;
};

const REASON_MIN = 3;
const REASON_MAX = 2000;

/**
 * `E3.1` (ADR 0122 decision 6) — an approver sends a resolved ticket back to work, with a
 * reason. Renders nothing for a role that cannot approve or a ticket that is not
 * `resolved`. A plain form, not a `WizardShell`.
 */
export function WorkOrderRejectForm({ row, role, onDone }: WorkOrderRejectFormProps) {
  const [reason, setReason] = useState("");
  const reject = useMutation({
    mutationFn: (text: string) => rejectWorkOrder(row.id, text),
    onSuccess: async (updated) => {
      await onDone(updated);
    },
  });
  if (!canApproveWorkOrders(role) || row.status !== "resolved") return null;
  const trimmed = reason.trim();

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (trimmed.length >= REASON_MIN) reject.mutate(trimmed);
  }

  return (
    <form aria-label="Reject work order" className="flex flex-col gap-2" onSubmit={submit}>
      <label className={labelClass}>
        Reason for rejecting
        <textarea className={fieldClass} rows={2} value={reason} maxLength={REASON_MAX} onChange={(e) => setReason(e.target.value)} />
      </label>
      <p className="text-xs text-ink-muted">The work order goes back to In progress.</p>
      <button
        type="submit"
        className="surface-button self-start px-4 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        disabled={trimmed.length < REASON_MIN || reject.isPending}
        aria-busy={reject.isPending}
      >
        {reject.isPending ? "Rejecting…" : "Reject and send back"}
      </button>
      {reject.error ? (
        <p role="alert" className="text-xs text-critical-ink">
          {apiErrorMessage(reject.error)}
        </p>
      ) : null}
    </form>
  );
}
