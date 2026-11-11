import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import type { UserRole, WorkOrderListItem, WorkOrderStatus } from "@bms/shared";

import { cancelWorkOrder } from "../../api/work-orders";
import { canApproveWorkOrders } from "../../lib/admin-access";
import { apiErrorMessage } from "../../lib/api-error-message";
import { fieldClass, labelClass } from "../admin/admin-wizard-frame";

export type WorkOrderCancelFormProps = {
  row: WorkOrderListItem;
  role: UserRole;
  onDone: (row: WorkOrderListItem) => void | Promise<void>;
};

const REASON_MIN = 3;
const REASON_MAX = 2000;
const CANCELLABLE: readonly WorkOrderStatus[] = ["open", "assigned", "in_progress", "resolved"];

/**
 * `E3.1` (ADR 0122 decision 6.8) — an approver cancels a live ticket, with a reason; it
 * cannot be undone. Renders nothing for a role that cannot approve or for a ticket that is
 * already closed or cancelled. A plain form, not a `WizardShell`.
 */
export function WorkOrderCancelForm({ row, role, onDone }: WorkOrderCancelFormProps) {
  const [reason, setReason] = useState("");
  const cancel = useMutation({
    mutationFn: (text: string) => cancelWorkOrder(row.id, text),
    onSuccess: async (updated) => {
      await onDone(updated);
    },
  });
  if (!canApproveWorkOrders(role) || !CANCELLABLE.includes(row.status)) return null;
  const trimmed = reason.trim();

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (trimmed.length >= REASON_MIN) cancel.mutate(trimmed);
  }

  return (
    <form aria-label="Cancel work order" className="flex flex-col gap-2" onSubmit={submit}>
      <label className={labelClass}>
        Reason for cancelling
        <textarea className={fieldClass} rows={2} value={reason} maxLength={REASON_MAX} onChange={(e) => setReason(e.target.value)} />
      </label>
      <p className="text-xs font-semibold text-critical-ink">This cannot be undone.</p>
      <button
        type="submit"
        className="surface-button self-start px-4 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        disabled={trimmed.length < REASON_MIN || cancel.isPending}
        aria-busy={cancel.isPending}
      >
        {cancel.isPending ? "Cancelling…" : "Cancel work order"}
      </button>
      {cancel.error ? (
        <p role="alert" className="text-xs text-critical-ink">
          {apiErrorMessage(cancel.error)}
        </p>
      ) : null}
    </form>
  );
}
