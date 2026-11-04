/**
 * `F4.311` PR 6a (ADR 0109 decision 7) — days of history to compute when a
 * calculated point is saved; "None" sends no field. Shared by the standalone
 * Add/Edit panel, the asset list's batch wizard and (`F4.311` PR 5, owner
 * ruling 1) the override wizard's Backfill step, which names its select after
 * the point through `label`.
 */
import { BACKFILL_DAY_CHOICES } from "../../lib/calc-point-draft";

export function BackfillDaysSelect({
  value,
  disabled,
  onChange,
  label = "Backfill history",
}: {
  value: string;
  disabled: boolean;
  onChange: (days: string) => void;
  /** The select's accessible name; the visible caption stays "Backfill history". */
  label?: string;
}) {
  return (
    <label className="block text-xs">
      <span className="text-ink-muted">Backfill history</span>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full surface-field px-2 py-1"
      >
        <option value="">None</option>
        {BACKFILL_DAY_CHOICES.map((days) => (
          <option key={days} value={String(days)}>
            {days === 1 ? "1 day" : `${days} days`}
          </option>
        ))}
      </select>
      <span className="mt-1 block text-[11px] text-ink-muted">
        Computes the point over this many past days when you save. Stored readings are never overwritten.
      </span>
    </label>
  );
}
