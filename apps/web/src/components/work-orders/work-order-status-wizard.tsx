import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { WorkOrderListItem } from "@bms/shared";

import { updateWorkOrderStatus, type UpdateWorkOrderStatusInput } from "../../api/work-orders";
import { apiErrorMessage } from "../../lib/api-error-message";
import { AdminWizardFrame, fieldClass, labelClass } from "../admin/admin-wizard-frame";
import { operationsWizardEntry } from "../alarm-ack-wizard";
import { WizardShell } from "../wizard/wizard-shell";
import { settableStatuses, statusLabels } from "./work-order-labels";

export type WorkOrderStatusWizardProps = {
  row: WorkOrderListItem;
  onCancel: () => void;
  onDone: (row: WorkOrderListItem) => Promise<void> | void;
};

/**
 * `F4.284` (ADR 0099 decision 6; ADR 0106 decision 2) — a work order's Edit status on
 * the shared `WizardShell`: Status → Review. The status list leaves out `closed`: a
 * close has its own wizard and a reason. Used by operators too; Submit sends the plain
 * `PATCH /work-orders/:id/status`.
 */
export function WorkOrderStatusWizard({ row, onCancel, onDone }: WorkOrderStatusWizardProps) {
  const [values, setValues] = useState<Record<string, unknown>>({ status: row.status === "closed" ? "open" : row.status });
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => updateWorkOrderStatus({ id: row.id, ...body } as UpdateWorkOrderStatusInput),
    onSuccess: async (updated) => onDone(updated),
  });
  const reason = typeof values.reason === "string" ? values.reason : "";
  const entry = operationsWizardEntry("workOrder.setStatus");
  return (
    <AdminWizardFrame title="Edit status">
      <p className="text-xs text-ink-muted">{row.title}</p>
      <WizardShell
        entry={operationsWizardEntry("workOrder.setStatus")}
        params={{ id: row.id }}
        values={values}
        onChange={setValues}
        current={{ status: row.status }}
        renderStep={() => (
          <>
            <label className={labelClass}>
              New status
              <select className={fieldClass} value={String(values.status ?? "")} onChange={(e) => setValues({ ...values, status: e.target.value })}>
                {settableStatuses.map((status) => (
                  <option key={status} value={status}>
                    {statusLabels[status]}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Reason
              <textarea
                className={fieldClass}
                rows={3}
                value={reason}
                placeholder="Optional state-change note"
                maxLength={2000}
                onChange={(e) => setValues({ ...values, reason: e.target.value === "" ? undefined : e.target.value })}
              />
            </label>
          </>
        )}
        onSubmit={(body) => save.mutate(body)}
        onCancel={onCancel}
        submitting={save.isPending}
        submitError={save.error ? apiErrorMessage(save.error) : null}
        summary={entry.summary({
          body: values,
          params: { id: row.id },
          targetName: row.title,
          organizationName: "",
          workOrder: { title: row.title, status: row.status, assetName: row.assetName },
        })}
      />
    </AdminWizardFrame>
  );
}
