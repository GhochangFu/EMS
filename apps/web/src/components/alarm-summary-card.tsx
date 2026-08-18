type AlarmSummaryCardProps = {
  label: string;
  value: number;
  /**
   * `offline` is the neutral grey, and matches `StatusPill`'s tone of the same
   * name (`status-pill.tsx:3`). The alarms page uses it for severities the
   * product does not recognise (`F4.46`), which are neither urgent nor calm.
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
  const border =
    tone === "critical"
      ? "after:bg-red-600"
      : tone === "warning"
        ? "after:bg-amber-500"
        : tone === "info"
          ? "after:bg-sky-500"
          : tone === "offline"
            ? "after:bg-gray-400"
            : "after:bg-bms-green";
  const icon =
    tone === "critical"
      ? "!"
      : tone === "warning"
        ? "!"
        : tone === "info"
          ? "i"
          : tone === "offline"
            ? "?"
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
