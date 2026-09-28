/**
 * The control-room breaker table (`F3.28` task 3.5), shared by `/cr-sld` and
 * the List view of `/cr-overview`.
 *
 * Presentational only: it renders the rows it is given and decides nothing
 * about freshness. Each page derives the status through its own
 * `derive…RuleState` (which calls `isStale` — a scanned repo invariant) and
 * gates the numbers through `breakerTableRow` in `lib/breaker-table-rows.ts`,
 * so a stale breaker arrives here already `offline` with `null` readings.
 */

/**
 * `offline` is distinct from `open` (ADR 0027 decision 5). `open` asserts the
 * breaker is open — a fact about the plant, only knowable from a current
 * reading. `offline` says we cannot see the breaker at all. On a single-line
 * diagram those must never look the same.
 */
export type BreakerVisualStatus = "normal" | "warning" | "critical" | "open" | "offline";

/** One table row. The three readings are already gated: `null` renders `—`. */
export type BreakerTableRow = {
  code: string;
  label: string;
  position: string;
  rating: string;
  status: BreakerVisualStatus;
  current: number | null;
  kw: number | null;
  kwhToday: number | null;
  tripCause: string;
};

function n(value: number | null, digits: number): string {
  return value == null || Number.isNaN(value) ? "—" : value.toFixed(digits);
}

export function breakerStatusClass(status: BreakerVisualStatus): string {
  if (status === "open") {
    return "border-line bg-well-deep text-neutral-ink";
  }
  // A deliberately different grey from `open` — see BreakerVisualStatus.
  if (status === "offline") {
    return "border-line-strong bg-line text-ink-muted";
  }
  if (status === "critical") {
    return "border-critical-line bg-critical-wash-strong text-critical-ink-strong";
  }
  if (status === "warning") {
    return "border-warning-line bg-warning-wash-strong text-warning-ink";
  }
  return "border-accent/20 bg-accent/10 text-accent";
}

/**
 * `offline` is tested FIRST, and that ordering is the fix rather than a style
 * choice: the chain ends in a green "healthy" default, so a status it does not
 * name falls through to *closed and energised*. Before this arm existed a
 * breaker whose telemetry had died read "CLOSED" — the exact claim F4.38 exists
 * to stop the page making. The compiler cannot catch it because this is a
 * ternary, not an exhaustive switch.
 */
function breakerStatusLabel(status: BreakerVisualStatus): string {
  return status === "offline"
    ? "OFFLINE"
    : status === "open"
      ? "OPEN"
      : status === "critical"
        ? "CRITICAL"
        : status === "warning"
          ? "WARN"
          : "CLOSED";
}

export function BreakerTable({ rows }: { rows: readonly BreakerTableRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-line text-sm">
        <thead className="bg-well text-left text-xs uppercase tracking-wide text-ink-muted">
          <tr>
            <th className="px-3 py-2">Breaker</th>
            <th className="px-3 py-2">Position</th>
            <th className="px-3 py-2">Rating</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2 text-right">I (A)</th>
            <th className="px-3 py-2 text-right">kW</th>
            <th className="px-3 py-2 text-right">kWh</th>
            <th className="px-3 py-2">Trip Cause</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.code}>
              <td className="px-3 py-2 font-medium text-ink">{row.label}</td>
              <td className="px-3 py-2 text-ink-muted">{row.position}</td>
              <td className="px-3 py-2">{row.rating}</td>
              <td className="px-3 py-2">
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${breakerStatusClass(row.status)}`}>
                  {breakerStatusLabel(row.status)}
                </span>
              </td>
              <td className="px-3 py-2 text-right font-mono">{n(row.current, 1)}</td>
              <td className="px-3 py-2 text-right font-mono">{n(row.kw, 2)}</td>
              <td className="px-3 py-2 text-right font-mono">{n(row.kwhToday, 1)}</td>
              <td className="px-3 py-2 text-ink-muted">{row.tripCause}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
