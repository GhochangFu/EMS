import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { WORK_ORDER_FINDING_MAX_LENGTH, WORK_ORDER_FINDING_MIN_LENGTH } from "@bms/shared/contracts";
import type { WorkOrderListItem, WorkOrderStatus } from "@bms/shared";

import {
  fetchWorkOrderCauseCodes,
  fetchWorkOrderDetail,
  updateWorkOrderStatus,
  type UpdateWorkOrderStatusInput,
} from "../../api/work-orders";
import { apiErrorMessage } from "../../lib/api-error-message";
import { AdminWizardFrame, fieldClass, labelClass } from "../admin/admin-wizard-frame";
import { operationsWizardEntry } from "../alarm-ack-wizard";
import { WizardShell } from "../wizard/wizard-shell";
import { settableStatuses, statusLabels } from "./work-order-labels";

export type WorkOrderStatusWizardProps = {
  row: WorkOrderListItem;
  /** The status the wizard opens on; the row's own when absent. A card dropped on Review opens it on `resolved`. */
  initialStatus?: WorkOrderStatus;
  onCancel: () => void;
  onDone: (row: WorkOrderListItem) => Promise<void> | void;
};

/** The three findings a ticket raised from an alarm owes before it is resolved (ADR 0122 decision 5.2). */
const REQUIRED_FINDINGS = [
  ["rootCause", "Cause found"],
  ["correctiveAction", "Corrective action"],
  ["causeCode", "Cause code"],
] as const;
const FINDING_TEXTS = [
  ["rootCause", "Cause found"],
  ["correctiveAction", "Corrective action"],
  ["preventiveAction", "Preventive action"],
] as const;
const FINDING_KEYS = ["rootCause", "correctiveAction", "preventiveAction", "causeCode"] as const;
/** The route's own bounds on a finding's text, from the contract. */
const FINDING_MIN = WORK_ORDER_FINDING_MIN_LENGTH;

export const ROOT_CAUSE_REQUIRED =
  "A work order raised from an alarm needs a cause, a corrective action and a cause code before it is resolved";

const typed = (values: Record<string, unknown>, key: string): string => (typeof values[key] === "string" ? (values[key] as string) : "");

/**
 * `F4.284` (ADR 0099 decision 6; ADR 0106 decision 2) — a work order's Edit status on
 * the shared `WizardShell`: Status → Review. The status list leaves out `closed`: a
 * close has its own wizard and a reason. Used by operators too; Submit sends the plain
 * `PATCH /work-orders/:id/status`.
 *
 * `E3.1` (ADR 0122 decision 5, plan T4.4): choosing `resolved` shows a **Root cause**
 * section — three texts and a coded cause — whose values ride the same `PATCH`. It is a
 * section of the Status step and not a step of its own, on purpose: the four fields are
 * `clientOnly` on the catalog entry (ruling P4: the copilot never writes findings), and
 * a `clientOnly` field may not sit in a catalog step. So the page owns them, as it owns
 * every other `clientOnly` field. A ticket raised from an alarm cannot leave the step
 * for `resolved` without the three the server requires; what is already saved on the
 * ticket counts, and shows as each field's placeholder.
 */
export function WorkOrderStatusWizard({ row, initialStatus, onCancel, onDone }: WorkOrderStatusWizardProps) {
  const [values, setValues] = useState<Record<string, unknown>>({
    status: initialStatus ?? (row.status === "closed" ? "open" : row.status),
  });
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => updateWorkOrderStatus({ id: row.id, ...body } as UpdateWorkOrderStatusInput),
    onSuccess: async (updated) => {
      // The findings may have changed: the next time this ticket's wizard opens it must not judge from the old ones.
      await queryClient.invalidateQueries({ queryKey: ["work-order", row.id] });
      await onDone(updated);
    },
  });
  const resolving = values.status === "resolved";
  // What the ticket already holds, so a finding saved earlier is not asked for again.
  const detail = useQuery({ queryKey: ["work-order", row.id], queryFn: () => fetchWorkOrderDetail(row.id), enabled: resolving });
  const causeCodes = useQuery({
    queryKey: ["work-order-cause-codes"],
    queryFn: fetchWorkOrderCauseCodes,
    enabled: resolving,
    staleTime: 5 * 60_000,
  });
  const saved: Record<string, string | null> = {
    rootCause: detail.data?.rootCause ?? null,
    correctiveAction: detail.data?.correctiveAction ?? null,
    preventiveAction: detail.data?.preventiveAction ?? null,
    causeCode: detail.data?.causeCode ?? row.causeCode,
  };
  const reason = typeof values.reason === "string" ? values.reason : "";
  const entry = operationsWizardEntry("workOrder.setStatus");

  /** A code as the list labels it; the code itself for one that is retired and so not in the list. */
  const causeLabel = (code: string): string => causeCodes.data?.items.find((item) => item.code === code)?.label ?? code;

  /** Sets one value; an emptied field is left out of the body, so the server keeps what it has. */
  const set = (key: string, value: string): void => setValues({ ...values, [key]: value === "" ? undefined : value });

  /** A status other than `resolved` sends no findings: the section is gone, and so are its values. */
  function setStatus(status: string): void {
    const next: Record<string, unknown> = { ...values, status };
    if (status !== "resolved") {
      for (const key of FINDING_KEYS) delete next[key];
    }
    setValues(next);
  }

  /** Why the step cannot be left, in the page's words; the server's gate is the final answer. */
  function blocker(): string | null {
    if (!resolving) return null;
    for (const [key, label] of FINDING_TEXTS) {
      const text = typed(values, key);
      if (text !== "" && text.trim().length < FINDING_MIN) return `${label} needs at least ${FINDING_MIN} characters`;
    }
    // While the saved findings are loading, or could not be read, the page cannot know
    // what is missing: it lets the step pass and the server's gate answers.
    if (row.alarmId === null || row.status === "resolved" || detail.isLoading || detail.isError) return null;
    const missing = REQUIRED_FINDINGS.some(([key]) => typed(values, key) === "" && !saved[key]);
    return missing ? ROOT_CAUSE_REQUIRED : null;
  }

  return (
    <AdminWizardFrame title="Edit status">
      <p className="text-xs text-ink-muted">{row.title}</p>
      <WizardShell
        entry={operationsWizardEntry("workOrder.setStatus")}
        params={{ id: row.id }}
        values={values}
        onChange={setValues}
        current={{ status: row.status }}
        stepBlocker={blocker}
        renderStep={() => (
          <>
            <label className={labelClass}>
              New status
              <select className={fieldClass} value={String(values.status ?? "")} onChange={(e) => setStatus(e.target.value)}>
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
            {resolving ? (
              <fieldset className="flex flex-col gap-2 rounded border border-line p-3">
                <legend className="px-1 text-xs font-semibold text-ink">Root cause</legend>
                <p className="text-xs text-ink-muted">
                  {row.alarmId === null
                    ? "Optional for planned work."
                    : "This work order was raised from an alarm: the cause, the corrective action and the cause code are required."}
                </p>
                {FINDING_TEXTS.map(([key, label]) => (
                  <label key={key} className={labelClass}>
                    {label}
                    <textarea
                      className={fieldClass}
                      rows={2}
                      value={typed(values, key)}
                      placeholder={saved[key] ?? ""}
                      maxLength={WORK_ORDER_FINDING_MAX_LENGTH}
                      onChange={(e) => set(key, e.target.value)}
                    />
                  </label>
                ))}
                <label className={labelClass}>
                  Cause code
                  <select className={fieldClass} value={typed(values, "causeCode")} onChange={(e) => set("causeCode", e.target.value)}>
                    <option value="">{saved.causeCode ? `Keep ${causeLabel(saved.causeCode)}` : "Select a cause"}</option>
                    {(causeCodes.data?.items ?? []).map((code) => (
                      <option key={code.code} value={code.code}>
                        {code.label}
                      </option>
                    ))}
                  </select>
                </label>
                {(causeCodes.error ?? detail.error) ? (
                  <p role="alert" className="text-xs text-critical-ink">
                    {apiErrorMessage(causeCodes.error ?? detail.error)}
                  </p>
                ) : null}
              </fieldset>
            ) : null}
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
