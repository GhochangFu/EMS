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
    return "border-gray-200 bg-gray-100 text-gray-700";
  }
  // A deliberately different grey from `open` — see BreakerVisualStatus.
  if (status === "offline") {
    return "border-gray-300 bg-gray-200 text-gray-600";
  }
  if (status === "critical") {
    return "border-red-200 bg-red-100 text-red-800";
  }
  if (status === "warning") {
    return "border-amber-200 bg-amber-100 text-amber-900";
  }
  return "border-bms-green/20 bg-bms-green/10 text-bms-green";
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
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-bms-muted">
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
        <tbody className="divide-y divide-gray-200">
          {rows.map((row) => (
            <tr key={row.code}>
              <td className="px-3 py-2 font-medium text-bms-ink">{row.label}</td>
              <td className="px-3 py-2 text-bms-muted">{row.position}</td>
              <td className="px-3 py-2">{row.rating}</td>
              <td className="px-3 py-2">
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${breakerStatusClass(row.status)}`}>
                  {breakerStatusLabel(row.status)}
                </span>
              </td>
              <td className="px-3 py-2 text-right font-mono">{n(row.current, 1)}</td>
              <td className="px-3 py-2 text-right font-mono">{n(row.kw, 2)}</td>
              <td className="px-3 py-2 text-right font-mono">{n(row.kwhToday, 1)}</td>
              <td className="px-3 py-2 text-bms-muted">{row.tripCause}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
