type AlarmSummaryCardProps = {
  label: string;
  value: number;
  /**
   * `offline` is the neutral grey, and matches `StatusPill`'s tone of the same
   * name (`status-pill.tsx:3`). The alarms page uses it for severities the
   * product does not recognise (`F4.46`), which are neither urgent nor calm.
   *
   * **It is a deliberate overload and worth knowing about.** ADR 0027 and §2
   * give `offline` a narrower meaning elsewhere — stale, no data — where it
   * outranks `critical` in a page banner. Reusing its grey for "unclassifiable"
   * is a second meaning on one colour. It is taken anyway because the two
   * readings agree on what they tell an operator (*this number is not telling
   * you the plant is calm*), and because inventing a sixth tone would have to
   * be invented in `StatusPill` too, where the same page needs it for the pill.
   * If a third meaning ever wants this grey, split the tone rather than stack
   * another one on it.
   */
  tone: "critical" | "warning" | "info" | "ok" | "offline";
  emptyLabel?: string;
};

/** Compact Alarm Centre KPI card aligned with the mockup summary row. */
export function AlarmSummaryCard({
  label,
  value,
  tone,
  emptyLabel,
}: AlarmSummaryCardProps) {
  // `offline` is tested first in both chains, per AGENTS.md §2: the default arm
  // of a status chain must be the *healthy* branch, so a tone added later draws
  // green and nobody notices. Putting `offline` last would have handed the next
  // tone exactly that silence. The compiler does not find these for you.
  const border =
    tone === "offline"
      ? "after:bg-gray-400"
      : tone === "critical"
        ? "after:bg-red-600"
        : tone === "warning"
          ? "after:bg-amber-500"
          : tone === "info"
            ? "after:bg-sky-500"
            : "after:bg-bms-green";
  const icon =
    tone === "offline"
      ? "?"
      : tone === "critical"
        ? "!"
        : tone === "warning"
          ? "!"
          : tone === "info"
            ? "i"
            : "o";

  return (
    <div className={`relative overflow-hidden rounded-lg border border-gray-200 bg-white p-4 shadow-sm after:absolute after:inset-x-0 after:top-0 after:h-0.5 ${border}`}>
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-bms-muted">
        <span className="grid h-6 w-6 place-items-center rounded border border-current bg-white/70 font-mono">
          {icon}
        </span>
        {label}
      </div>
      {value === 0 && emptyLabel ? (
        <p className="mt-4 text-sm text-bms-muted">{emptyLabel}</p>
      ) : (
        <p className="mt-4 font-condensed text-3xl font-bold tabular-nums text-bms-ink">
          {value}
        </p>
      )}
    </div>
  );
}
