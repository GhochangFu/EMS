import type { OnboardingSessionDto } from "@bms/shared";

type UndoPickerProps = {
  /** The session's checkpoints, newest first; the select's default is the newest. */
  checkpoints: readonly OnboardingSessionDto["checkpoints"][number][];
  /** The checkpoint the Undo button rolls back to. */
  value: string;
  onChange: (checkpointId: string) => void;
  onUndo: (checkpointId: string) => void;
  /** The rollback is in flight. */
  undoing: boolean;
  /** Another write (a chat turn) is in flight: one write at a time. */
  blocked: boolean;
  /** The session has a draft hash to bind the rollback to. */
  canUndo: boolean;
};

/**
 * `F3.25` (ADR 0094 decision 6) — the checkpoint select and the Undo button.
 * Extracted from the onboarding page in `F3.86` PR 6 so the copilot dock's
 * onboarding skill renders the same control; the markup is the page's,
 * unchanged.
 */
export function UndoPicker({ checkpoints, value, onChange, onUndo, undoing, blocked, canUndo }: UndoPickerProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 pt-3">
      <select
        aria-label="Undo to"
        data-testid="undo-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={undoing || blocked}
        className="surface-field px-2 py-1 text-xs"
      >
        {checkpoints.map((c) => (
          <option key={c.id} value={c.id}>
            {`Step ${c.seq}: ${c.label}`}
          </option>
        ))}
      </select>
      <button
        type="button"
        data-testid="undo-button"
        onClick={() => onUndo(value)}
        // Review finding (F3.25): one write in flight at a time — a turn
        // that overlaps an undo would write its pre-undo draft back.
        disabled={!canUndo || undoing || blocked}
        aria-busy={undoing}
        className="surface-button px-3 py-1 text-xs disabled:opacity-50"
      >
        {undoing ? "Undoing…" : "Undo"}
      </button>
    </div>
  );
}
