import type { ChartSeriesKind } from "@bms/shared";

import { CHART_SERIES_OPTIONS } from "../../lib/widget-config-form";

type ChartSeriesPickerProps = {
  value: ChartSeriesKind;
  onChange: (value: ChartSeriesKind) => void;
  disabled?: boolean;
};

/**
 * `F3.1d` Unit 7 — the four plain chart-series labels an author picks from.
 *
 * **Read from `CHART_SERIES_OPTIONS`, never restated.** This is the file
 * `tests/f3.1c-widget-series-mapping.test.ts`'s docblock names by path and
 * deliberately does not allowlist (plan §12): a second hand-written copy of
 * *Trend* / *Trend (filled)* / *Comparison bars* / *Scatter* here fails that
 * scan. Fix this component, never the scan.
 */
export function ChartSeriesPicker({ value, onChange, disabled }: ChartSeriesPickerProps) {
  return (
    <select
      aria-label="Chart kind"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as ChartSeriesKind)}
      className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
    >
      {CHART_SERIES_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
