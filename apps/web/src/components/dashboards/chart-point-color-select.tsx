import type { SeriesRole } from "@bms/shared";

import { CHART_COLOR_OPTIONS } from "../../lib/widget-config-form";

/** Literal class names, so Tailwind sees each one (the trend strip wizard's swatch map). */
const SWATCH: Record<SeriesRole, string> = {
  "series-1": "bg-series-1",
  "series-2": "bg-series-2",
  "series-3": "bg-series-3",
  "series-4": "bg-series-4",
  "series-5": "bg-series-5",
  "series-6": "bg-series-6",
  "series-7": "bg-series-7",
  "series-8": "bg-series-8",
};

/**
 * `F4.325` (ADR 0047 Amendment 8 item 1) — the Colour select beside one chart point, in the
 * dashboard inspector and the asset-template widget editor. `""` is *Default*: the palette colour
 * the point's position already draws in, so no swatch is claimed for it.
 */
export function ChartPointColorSelect({
  pointLabel,
  value,
  disabled = false,
  onChange,
}: {
  pointLabel: string;
  value: SeriesRole | "";
  disabled?: boolean;
  onChange: (value: SeriesRole | "") => void;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      {value === "" ? null : <span aria-hidden="true" className={`inline-block h-3 w-3 rounded-full ${SWATCH[value]}`} />}
      <select
        aria-label={`Colour of ${pointLabel}`}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value as SeriesRole | "")}
        className="surface-field px-1 py-0.5 text-2xs disabled:opacity-60"
      >
        {CHART_COLOR_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}
