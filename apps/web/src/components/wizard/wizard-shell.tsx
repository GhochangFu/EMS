import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type { CatalogEntry } from "@bms/shared/copilot";

import { changeRows } from "../../lib/copilot-diff";
import {
  applyFill,
  bodyProblems,
  guardWizardLeave,
  type LeaveDecision,
  nextStepId,
  previousStepId,
  REVIEW_STEP,
  stepProblems,
  type WizardStep,
  wizardBody,
  wizardStepsOf,
} from "../../lib/wizard-steps";
import { useWizardStore } from "../../stores/wizard-store";
import { ChangeCard } from "../copilot/change-card";

type WizardShellProps = {
  /** The catalog entry this wizard submits (`@bms/shared/copilot`). */
  entry: CatalogEntry;
  /** The form's values, keyed by body field; the page owns them. */
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  /** The page's inputs for one field step. */
  renderStep: (step: WizardStep) => ReactNode;
  /** Sends the plain request — no `X-Copilot-Change` header: a wizard used alone is not a copilot change. */
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel: () => void;
  submitting: boolean;
  submitError?: string | null;
  /** The record now, for an edit's Review: its values show beside the new ones. */
  current?: Record<string, unknown> | null;
  /** The Review card's sentence; the entry's title when absent. */
  summary?: string;
  /**
   * The page's own "changed", for work done by clicks — for example adding or dragging
   * widgets — which no field `change` event reports. Cancel asks first when this is true or
   * when the shell saw a change itself.
   */
  dirty?: boolean;
};

/**
 * `F3.85` PR 8 / ADR 0099 decision 6 (plan §10.3, ruling Q6) — the stepper
 * every catalog route's form uses (PRs 9–11 build the pages on it).
 *
 * The steps are the entry's field steps, then Review (`lib/wizard-steps.ts`);
 * a route with no body fields is Review alone. **Next** checks the step's own
 * fields and stays when one is wrong; **Back** never checks. **Review** shows
 * the body as a card (`ChangeCard`) and parses it whole, refinements
 * included, before **Submit** can send it.
 *
 * Leaving with values the user typed asks first (the `guardTabSwitch` rule;
 * a field's React `onChange`, bubbled to the shell, marks the wizard changed;
 * the page's `dirty` prop covers work done by clicks);
 * moving between steps never does. The shell marks itself on `change`, not on
 * `input` (`F3.85` PR 9): an `input` re-render landed between a `<select>`'s
 * `input` and `change` events, gave the controlled select its old value back,
 * and lost a select-first pick; the bubbled `onChange` batches with the page's. Values the copilot's `fill_step` gave this
 * entry (`useWizardStore`) are merged into the named step's fields only, and
 * mark the wizard as changed.
 */
export function WizardShell(props: WizardShellProps) {
  const { entry, values, onChange } = props;
  const steps = wizardStepsOf(entry);
  const [stepId, setStepId] = useState<string>(steps[0]?.id ?? REVIEW_STEP.id);
  const [dirty, setDirty] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [leave, setLeave] = useState<Extract<LeaveDecision, { allow: false }> | null>(null);
  const seq = useWizardStore((s) => s.seq);
  const take = useWizardStore((s) => s.take);

  useEffect(() => {
    const fill = take(entry.id);
    if (fill === null) return;
    const next = applyFill(entry.id, steps, values, fill);
    if (next === null) return;
    setDirty(true);
    onChange(next);
    // Each fill is read once, when it arrives: `seq` is the only trigger.
  }, [seq]);

  const step = steps.find((candidate) => candidate.id === stepId) ?? REVIEW_STEP;
  const index = steps.indexOf(step);
  const body = wizardBody(values);
  const reviewProblems = step.id === REVIEW_STEP.id ? bodyProblems(entry, body) : [];

  function goNext(): void {
    const found = stepProblems(entry, step, values);
    setProblems(found);
    if (found.length === 0) setStepId(nextStepId(steps, step.id));
  }

  function goBack(): void {
    setProblems([]);
    setStepId(previousStepId(steps, step.id));
  }

  function cancel(): void {
    const decision = guardWizardLeave(dirty || props.dirty === true, entry.title);
    if (decision.allow) props.onCancel();
    else setLeave(decision);
  }

  return (
    <div className="flex flex-col gap-3" onChange={() => setDirty(true)}>
      <ol aria-label="Steps" className="flex flex-wrap gap-2 text-xs">
        {steps.map((candidate, position) => (
          <li
            key={candidate.id}
            aria-current={candidate.id === step.id ? "step" : undefined}
            className={candidate.id === step.id ? "font-semibold text-accent" : "text-ink-muted"}
          >
            {position + 1}. {candidate.title}
          </li>
        ))}
      </ol>

      {step.id === REVIEW_STEP.id ? (
        <ChangeCard
          title={entry.title}
          summary={props.summary ?? entry.title}
          risk={entry.risk}
          rows={changeRows(body, props.current ?? null, [], entry.formulas)}
          error={props.submitError ?? (reviewProblems.length > 0 ? reviewProblems.join("; ") : null)}
          busy={props.submitting}
          confirmLabel="Submit"
          busyLabel="Submitting…"
          onConfirm={() => {
            if (reviewProblems.length === 0) props.onSubmit(body);
          }}
          secondaryLabel={index > 0 ? "Back" : undefined}
          onSecondary={index > 0 ? goBack : undefined}
        />
      ) : (
        <section aria-label={step.title} className="flex flex-col gap-2">
          {props.renderStep(step)}
          {problems.length > 0 && (
            <ul role="alert" className="rounded border border-critical-line bg-critical-wash px-3 py-2 text-xs text-critical-ink">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            {index > 0 && (
              <button type="button" onClick={goBack} className="surface-button px-3 py-1 text-xs">
                Back
              </button>
            )}
            <button type="button" onClick={goNext} className="surface-button-primary px-3 py-1 text-xs">
              Next
            </button>
          </div>
        </section>
      )}

      {leave === null ? (
        <div className="flex justify-start">
          <button type="button" onClick={cancel} className="text-xs text-ink-muted underline">
            Cancel
          </button>
        </div>
      ) : (
        <div role="alertdialog" aria-label="Leave the wizard" className="surface-raised-sm flex flex-col gap-2 px-3 py-2 text-xs">
          <p>{leave.prompt}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setLeave(null)} className="surface-button px-3 py-1 text-xs">
              {leave.cancelLabel}
            </button>
            <button
              type="button"
              onClick={props.onCancel}
              className="rounded border border-critical-line px-3 py-1 text-xs font-semibold text-critical-ink"
            >
              {leave.confirmLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
