import type { ReactNode } from "react";
import type { CopilotChangeRisk } from "@bms/shared";

import { type ChangeRow, fieldLabel } from "../../lib/copilot-diff";

/**
 * `F3.85` PR 8 (plan §10.3, decision 4) — what one change will do, as a card:
 * its title and summary, one row per field it sends (with the record's value
 * now, for an edit), a note, and the two buttons. Presentational only: the
 * copilot's Confirm card (`confirm-card.tsx`) and a wizard's Review step
 * (`components/wizard/wizard-shell.tsx`) each own what the buttons do.
 *
 * A change that deactivates (or, in release 2, changes access) is styled red,
 * its Confirm button too.
 */
type ChangeCardProps = {
  title: string;
  summary: string;
  risk: CopilotChangeRisk;
  rows: readonly ChangeRow[];
  note?: string;
  error?: string | null;
  busy: boolean;
  confirmLabel: string;
  busyLabel: string;
  onConfirm: () => void;
  /** Reject (a copilot card) or Back (a wizard); absent hides the button. */
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** No action is possible any more (the change was applied, rejected or is gone). */
  closed?: boolean;
  /** `F3.86` PR 2: what the card asks before Confirm (the `clientOnly` inputs); shown above the buttons. */
  children?: ReactNode;
  /** `F3.86` PR 2: Confirm waits for `children` to be complete. */
  confirmDisabled?: boolean;
};

const RED_RISKS: ReadonlySet<CopilotChangeRisk> = new Set(["deactivate", "access"]);

/**
 * `F4.246` (ADR 0099 §3, owner ruling 2026-10-20 option C, "Summary + expand") — a cell's value:
 * the summary alone when it is the whole value, else the summary as a `<details>` control that
 * opens to the full value. Every value cell wraps (`break-all`), so a full formula row's long
 * expression wraps in the dock instead of overflowing it.
 */
function ValueText(props: { text: string; full: string | undefined }) {
  if (props.full === undefined) return <>{props.text}</>;
  return (
    <details>
      <summary className="cursor-pointer">{props.text}</summary>
      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px]">{props.full}</pre>
    </details>
  );
}

export function ChangeCard(props: ChangeCardProps) {
  const red = RED_RISKS.has(props.risk);
  const hasBefore = props.rows.some((row) => row.before !== undefined);
  return (
    <section
      aria-label={props.title}
      data-risk={props.risk}
      className={`px-3 py-2 text-xs ${red ? "rounded border border-critical-line bg-critical-wash" : "surface-raised-sm"}`}
    >
      <h3 className={`font-semibold ${red ? "text-critical-ink" : "text-ink"}`}>{props.title}</h3>
      <p className="mt-1 text-ink">{props.summary}</p>
      {props.rows.length > 0 && (
        <table className="mt-2 w-full table-fixed border-collapse">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-ink-muted">
              <th scope="col" className="w-1/3 py-0.5 font-semibold">
                Field
              </th>
              {hasBefore && (
                <th scope="col" className="py-0.5 font-semibold">
                  Now
                </th>
              )}
              <th scope="col" className="py-0.5 font-semibold">
                {hasBefore ? "After" : "Value"}
              </th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => (
              <tr key={row.field} data-changed={row.changed} className={row.changed ? "text-ink" : "text-ink-muted"}>
                <th scope="row" className="truncate py-0.5 pr-2 text-left font-normal">
                  {row.label ?? fieldLabel(row.field)}
                </th>
                {hasBefore && (
                  <td className="whitespace-pre-wrap break-all py-0.5 pr-2">
                    <ValueText text={row.before ?? "—"} full={row.beforeFull} />
                  </td>
                )}
                <td className="whitespace-pre-wrap break-all py-0.5">
                  <ValueText text={row.after} full={row.afterFull} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {props.note && <p className="mt-2 text-[11px] text-ink-muted">{props.note}</p>}
      {!props.closed && props.children}
      {props.error && (
        <p role="alert" className="mt-2 rounded border border-critical-line bg-critical-wash px-2 py-1 text-critical-ink">
          {props.error}
        </p>
      )}
      {!props.closed && (
        <div className="mt-2 flex justify-end gap-2">
          {props.secondaryLabel && props.onSecondary && (
            <button
              type="button"
              onClick={props.onSecondary}
              disabled={props.busy}
              className="surface-button px-3 py-1 text-xs disabled:opacity-50"
            >
              {props.secondaryLabel}
            </button>
          )}
          <button
            type="button"
            onClick={props.onConfirm}
            disabled={props.busy || props.confirmDisabled === true}
            aria-busy={props.busy}
            className={
              red
                ? "rounded border border-critical-line px-3 py-1 text-xs font-semibold text-critical-ink disabled:opacity-50"
                : "surface-button-primary px-3 py-1 text-xs disabled:opacity-50"
            }
          >
            {props.busy ? props.busyLabel : props.confirmLabel}
          </button>
        </div>
      )}
    </section>
  );
}
