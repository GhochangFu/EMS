import { useEffect, useState } from "react";

import { pointAggregateFunctionSchema, pointAggregateQuerySchema } from "@bms/shared";
import type { PointAggregateFunction } from "@bms/shared";

import {
  HISTORY_PRESETS,
  instantToLocalInput,
  localInputToInstant,
  type HistoryRange,
} from "../../lib/asset-history-range";

const FUNCTION_LABELS: Record<PointAggregateFunction, string> = {
  avg: "Average",
  min: "Minimum",
  max: "Maximum",
  sum: "Sum",
};

type RangePickerProps = {
  range: HistoryRange;
  /** The site zone the custom inputs are read in (ADR 0108 decision 1.9). */
  zone: string;
  /** The zone's printed name. */
  zoneLabel: string;
  onChange: (next: HistoryRange) => void;
};

/**
 * `F4.297` U5 — the range controls: five trailing presets, a custom from/to pair, the compare
 * toggle and the bucket function (all four `pointAggregateFunctionSchema` values, owner Q3).
 *
 * The custom `datetime-local` pair is wall time in the site zone, never the browser's; it is
 * applied as one pair, so a half-typed range never reaches the URL or the server.
 */
export function RangePicker({ range, zone, zoneLabel, onChange }: RangePickerProps) {
  const [from, setFrom] = useState(() => instantToLocalInput(range.from, zone));
  const [to, setTo] = useState(() => instantToLocalInput(range.to, zone));
  const [error, setError] = useState<string | null>(null);

  // The zone arrives with the first aggregate answer; re-read the inputs in it.
  useEffect(() => {
    setFrom(instantToLocalInput(range.from, zone));
    setTo(instantToLocalInput(range.to, zone));
  }, [range.from, range.to, zone]);

  function applyCustom(): void {
    const fromIso = localInputToInstant(from, zone);
    const toIso = localInputToInstant(to, zone);
    if (fromIso === null || toIso === null) {
      setError("Enter both a start and an end.");
      return;
    }
    if (Date.parse(toIso) <= Date.parse(fromIso)) {
      setError("The end must be after the start.");
      return;
    }
    // The server's own rules (each end in range, the span limit): a pair it would refuse is
    // refused here with the contract's sentence, rather than as a bare 400 on every series.
    const checked = pointAggregateQuerySchema.safeParse({ from: fromIso, to: toIso });
    if (!checked.success) {
      setError(checked.error.issues[0]?.message ?? "The range is not valid.");
      return;
    }
    setError(null);
    onChange({ ...range, range: "custom", from: fromIso, to: toIso });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <div role="group" aria-label="Range" className="flex gap-1">
        {HISTORY_PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            aria-pressed={range.range === preset.key}
            className={`rounded border px-2 py-1 text-xs ${
              range.range === preset.key ? "border-accent bg-accent text-on-accent font-semibold" : "border-line-strong"
            }`}
            onClick={() => {
              setError(null);
              onChange({ ...range, range: preset.key, from: undefined, to: undefined });
            }}
          >
            {preset.key}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-1 text-xs text-ink-muted">
        From
        <input
          type="datetime-local"
          aria-label="From"
          className="surface-field px-2 py-1 text-xs"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
      </label>
      <label className="flex items-center gap-1 text-xs text-ink-muted">
        To
        <input
          type="datetime-local"
          aria-label="To"
          className="surface-field px-2 py-1 text-xs"
          value={to}
          onChange={(event) => setTo(event.target.value)}
        />
      </label>
      <button type="button" className="rounded border border-line-strong px-2 py-1 text-xs" onClick={applyCustom}>
        Apply
      </button>
      <span className="text-[11px] text-ink-muted">Times in {zoneLabel}</span>
      <label className="flex items-center gap-1 text-xs">
        <input
          type="checkbox"
          checked={range.compare}
          onChange={(event) => onChange({ ...range, compare: event.target.checked })}
        />
        Compare with the previous period
      </label>
      <select
        aria-label="Bucket function"
        className="surface-field px-2 py-1 text-xs"
        value={range.fn}
        onChange={(event) => {
          const fn = pointAggregateFunctionSchema.safeParse(event.target.value);
          if (fn.success) {
            onChange({ ...range, fn: fn.data });
          }
        }}
      >
        {pointAggregateFunctionSchema.options.map((fn) => (
          <option key={fn} value={fn}>
            {FUNCTION_LABELS[fn]}
          </option>
        ))}
      </select>
      {error ? (
        <p role="alert" className="w-full text-xs text-critical-ink-strong">
          {error}
        </p>
      ) : null}
    </div>
  );
}
