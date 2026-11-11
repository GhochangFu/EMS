import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import type { WorkOrderTaskDto } from "@bms/shared";

import { addWorkOrderTask, updateWorkOrderTask } from "../../api/work-orders";
import { apiErrorMessage } from "../../lib/api-error-message";
import { fieldClass } from "../admin/admin-wizard-frame";

export type WorkOrderChecklistProps = {
  workOrderId: string;
  tasks: WorkOrderTaskDto[];
  /** The ticket is resolved, closed or cancelled: every control is disabled. */
  readOnly: boolean;
  onChanged: () => void | Promise<void>;
};

type TaskResult = WorkOrderTaskDto["result"];

const TITLE_MIN = 2;

/**
 * `E3.1` (ADR 0122 decision 4) — the detail drawer's checklist: tick, mark not applicable
 * or reset each item, and add one by hand. A plain form, not a `WizardShell` (the route is
 * excluded from the copilot catalog). Every write calls `onChanged` so the drawer re-reads
 * the ticket; a refusal shows the server's sentence.
 */
export function WorkOrderChecklist({ workOrderId, tasks, readOnly, onChanged }: WorkOrderChecklistProps) {
  const [title, setTitle] = useState("");
  const [mandatory, setMandatory] = useState(false);
  const setResult = useMutation({
    mutationFn: (input: { taskId: string; result: TaskResult }) => updateWorkOrderTask(workOrderId, input.taskId, { result: input.result }),
    onSuccess: async () => {
      await onChanged();
    },
  });
  const add = useMutation({
    mutationFn: (input: { title: string; mandatory: boolean }) => addWorkOrderTask(workOrderId, input),
    onSuccess: async () => {
      setTitle("");
      setMandatory(false);
      await onChanged();
    },
  });
  const done = tasks.filter((task) => task.result !== "pending").length;
  const busy = setResult.isPending || add.isPending;
  const error = setResult.error ?? add.error;
  const trimmed = title.trim();

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (trimmed.length >= TITLE_MIN) add.mutate({ title: trimmed, mandatory });
  }

  return (
    <section aria-label="Checklist" className="flex flex-col gap-2">
      <p className="text-xs font-semibold text-ink">
        {done} of {tasks.length} done
      </p>
      {tasks.length === 0 ? <p className="text-xs text-ink-muted">No checklist items.</p> : null}
      <ul className="flex flex-col gap-1">
        {tasks.map((task) => (
          <li key={task.id} className="flex flex-wrap items-center gap-2 rounded border border-line bg-canvas px-2 py-1">
            <label className="flex items-center gap-2 text-xs text-ink">
              <input
                type="checkbox"
                checked={task.result === "done"}
                disabled={readOnly || busy}
                onChange={(e) => setResult.mutate({ taskId: task.id, result: e.target.checked ? "done" : "pending" })}
              />
              {task.title}
            </label>
            {task.mandatory ? <span className="text-3xs font-semibold text-ink-muted">Mandatory</span> : null}
            {task.result === "not_applicable" ? (
              <>
                <span className="text-3xs text-ink-muted">Not applicable</span>
                <button
                  type="button"
                  className="surface-button px-2 py-1 text-2xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={readOnly || busy}
                  aria-busy={setResult.isPending}
                  onClick={() => setResult.mutate({ taskId: task.id, result: "pending" })}
                >
                  {setResult.isPending ? "Saving…" : "Reset"}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="surface-button px-2 py-1 text-2xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                disabled={readOnly || busy}
                aria-busy={setResult.isPending}
                onClick={() => setResult.mutate({ taskId: task.id, result: "not_applicable" })}
              >
                {setResult.isPending ? "Saving…" : "Not applicable"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {readOnly ? (
        <p className="text-xs text-ink-muted">The checklist is locked once the work order is resolved.</p>
      ) : (
        <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
          <label className="text-xs font-semibold text-ink-muted">
            New checklist item
            <input className={fieldClass} value={title} maxLength={255} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 pb-2 text-xs text-ink">
            <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} />
            Mandatory item
          </label>
          <button
            type="submit"
            className="surface-button px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            disabled={trimmed.length < TITLE_MIN || busy}
            aria-busy={add.isPending}
          >
            {add.isPending ? "Adding…" : "Add item"}
          </button>
        </form>
      )}
      {error ? (
        <p role="alert" className="text-xs text-critical-ink">
          {apiErrorMessage(error)}
        </p>
      ) : null}
    </section>
  );
}
