import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { WORK_ORDER_FINDING_MAX_LENGTH, WORK_ORDER_FINDING_MIN_LENGTH } from "@bms/shared/contracts";
import type { WorkOrderDetail } from "@bms/shared";

import { fetchWorkOrderCauseCodes, putWorkOrderRootCause } from "../../api/work-orders";
import { apiErrorMessage } from "../../lib/api-error-message";
import { fieldClass, labelClass } from "../admin/admin-wizard-frame";

export type WorkOrderRootCauseFormProps = {
  workOrderId: string;
  detail: WorkOrderDetail;
  /** The ticket is closed or cancelled: the fields are disabled and there is no Save. */
  readOnly: boolean;
  onSaved: () => void | Promise<void>;
};

const TEXTS = [
  ["rootCause", "Cause found"],
  ["correctiveAction", "Corrective action"],
  ["preventiveAction", "Preventive action"],
] as const;
type TextKey = (typeof TEXTS)[number][0];

/** An empty text is `null` on the wire; a text is trimmed. */
const orNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());

/**
 * `E3.1` (ADR 0122 decision 5) — the detail drawer's root-cause form: three findings and a
 * coded cause, saved whole with `PUT`. A plain form, not a `WizardShell`. A cause code the
 * ticket holds but the active list no longer offers stays selectable.
 */
export function WorkOrderRootCauseForm({ workOrderId, detail, readOnly, onSaved }: WorkOrderRootCauseFormProps) {
  const [texts, setTexts] = useState<Record<TextKey, string>>({
    rootCause: detail.rootCause ?? "",
    correctiveAction: detail.correctiveAction ?? "",
    preventiveAction: detail.preventiveAction ?? "",
  });
  const [code, setCode] = useState(detail.causeCode ?? "");
  const causeCodes = useQuery({
    queryKey: ["work-order-cause-codes"],
    queryFn: fetchWorkOrderCauseCodes,
    staleTime: 5 * 60_000,
  });
  const save = useMutation({
    mutationFn: () =>
      putWorkOrderRootCause(workOrderId, {
        rootCause: orNull(texts.rootCause),
        correctiveAction: orNull(texts.correctiveAction),
        preventiveAction: orNull(texts.preventiveAction),
        causeCode: code === "" ? null : code,
      }),
    onSuccess: async () => {
      await onSaved();
    },
  });
  const options = causeCodes.data?.items ?? [];
  const retired = causeCodes.data !== undefined && detail.causeCode !== null &&!options.some((item) => item.code === detail.causeCode);
  const tooShort = TEXTS.some(([key]) => texts[key].trim() !== "" && texts[key].trim().length < WORK_ORDER_FINDING_MIN_LENGTH);
  const changed =
    TEXTS.some(([key]) => orNull(texts[key]) !== orNull(detail[key] ?? "")) || (code === "" ? null : code) !== detail.causeCode;
  const error = save.error ?? causeCodes.error;

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (changed && !tooShort) save.mutate();
  }

  return (
    <form aria-label="Root cause" className="flex flex-col gap-2" onSubmit={submit}>
      {TEXTS.map(([key, label]) => (
        <label key={key} className={labelClass}>
          {label}
          <textarea
            className={fieldClass}
            rows={2}
            value={texts[key]}
            disabled={readOnly}
            maxLength={WORK_ORDER_FINDING_MAX_LENGTH}
            onChange={(e) => setTexts({ ...texts, [key]: e.target.value })}
          />
        </label>
      ))}
      <label className={labelClass}>
        Cause code
        <select className={fieldClass} value={code} disabled={readOnly} onChange={(e) => setCode(e.target.value)}>
          <option value="">Not set</option>
          {retired && detail.causeCode !== null ? <option value={detail.causeCode}>{detail.causeCode}</option> : null}
          {options.map((item) => (
            <option key={item.code} value={item.code}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      {tooShort ? <p className="text-xs text-ink-muted">Each entry needs at least {WORK_ORDER_FINDING_MIN_LENGTH} characters.</p> : null}
      {readOnly ? (
        <p className="text-xs text-ink-muted">The root cause is locked once the work order is closed.</p>
      ) : (
        <button
          type="submit"
          className="surface-button self-start px-4 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!changed || tooShort || save.isPending}
          aria-busy={save.isPending}
        >
          {save.isPending ? "Saving…" : "Save root cause"}
        </button>
      )}
      {error ? (
        <p role="alert" className="text-xs text-critical-ink">
          {apiErrorMessage(error)}
        </p>
      ) : null}
    </form>
  );
}
