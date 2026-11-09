import { useState } from "react";

import { COST_DAYS_MESSAGE, costChartDays, rowWithCostDays } from "../../lib/cost-by-day-form";
import type { DashboardWidgetRow } from "../../lib/dashboard-builder-form";

type CostByDayFieldsProps = {
  row: DashboardWidgetRow;
  onChange: (patch: Partial<DashboardWidgetRow>) => void;
};

/**
 * `F4.332` (ADR 0047 Amendment 9 item 5) — the inspector's fields for a daily energy cost chart:
 * how many local days it reads, and a plain sentence of what it draws. It binds no point, so the
 * point picker is hidden, and the window, axis and aggregate fields do not apply.
 */
export function CostByDayFields({ row, onChange }: CostByDayFieldsProps) {
  // The author's text, so an empty or half-typed field stays as typed; the row holds the last
  // valid count, which is what saves.
  const [text, setText] = useState(String(costChartDays(row)));
  const valid = rowWithCostDays(text) !== null;
  return (
    <div className="space-y-2">
      <label className="block text-2xs font-semibold uppercase tracking-wide text-ink-muted">
        Days read
        <input
          type="text"
          inputMode="numeric"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            const patch = rowWithCostDays(event.target.value);
            if (patch !== null) onChange(patch);
          }}
          className="surface-field mt-1 w-full px-2 py-1.5 text-xs font-normal normal-case"
        />
      </label>
      {valid ? null : <p className="text-2xs text-critical-ink">{COST_DAYS_MESSAGE}</p>}
      <p className="text-2xs text-ink-muted">
        One bar per local day: each hour&apos;s energy priced at the rate in force in that hour. Viewers switch between 7,
        30 and 90 days (up to the days read); the total under the chart is the sum of the bars shown.
      </p>
    </div>
  );
}
