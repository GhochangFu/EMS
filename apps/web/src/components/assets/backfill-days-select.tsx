/**
 * `F4.311` PR 6a (ADR 0109 decision 7) — days of history to compute when a
 * standalone calculated point is saved; "None" sends no field. Shared by the
 * Add/Edit panel and the asset list's batch wizard.
 */
import { BACKFILL_DAY_CHOICES } from "../../lib/calc-point-draft";

export function BackfillDaysSelect({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (days: string) => void;
}) {
  return (
    <label className="block text-xs">
      <span className="text-ink-muted">Backfill history</span>
      <select
        aria-label="Backfill history"
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
