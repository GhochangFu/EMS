import type { EnergyViewRange } from "@bms/shared";

import { ENERGY_RANGES, instantToZoneInput, zoneInputToInstant, zoneLabel } from "../../lib/energy-view-filter";

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const labelClass = "grid gap-1 text-xs text-ink-muted";
const fieldClass = "surface-field px-2 py-1.5 text-sm";

/** The part of the Energy filter that is the same on every page: the range, its custom ends, the compare toggle. */
export type RangeCompareValue = {
  range: EnergyViewRange;
  from?: string;
  to?: string;
  compare?: "previous";
};

type RangeCompareControlsProps = {
  value: RangeCompareValue;
  onChange: (next: RangeCompareValue) => void;
  /**
   * The zone of the last response, or `null` before the first answer. The
   * custom pickers read and show wall time in this zone, never the browser's
   * (ADR 0108 Status ruling c), so they wait while it is `null`.
   */
  timeZone: string | null;
  /** Injected for tests; seeds a new custom range with the last 24 h. */
  now?: () => Date;
};

/**
 * `F4.302` U3 (ADR 0108 Amendment 4 item 3) — the range select, the custom
 * from/to pickers and the compare toggle, extracted from `EnergyFilterBar` so
 * the site page's Trends & Energy section reuses them. Controlled; renders a
 * fragment so the caller owns the layout. It emits the whole range/compare
 * value, never a field it did not own.
 */
export function RangeCompareControls({ value, onChange, timeZone, now = () => new Date() }: RangeCompareControlsProps) {
  const onRange = (range: EnergyViewRange): void => {
    if (range !== "custom") {
      onChange({ range, ...(value.compare !== undefined ? { compare: value.compare } : {}) });
      return;
    }
    const endMs = Math.floor(now().getTime() / MINUTE_MS) * MINUTE_MS;
    onChange({
      ...value,
      range,
      from: value.from ?? new Date(endMs - 24 * HOUR_MS).toISOString(),
      to: value.to ?? new Date(endMs).toISOString(),
    });
  };

  const onInstant = (key: "from" | "to", input: string): void => {
    if (timeZone === null) {
      return;
    }
    const instant = zoneInputToInstant(input, timeZone);
    if (instant === null) {
      const next = { ...value };
      delete next[key];
      onChange(next);
      return;
    }
    onChange({ ...value, [key]: instant });
  };

  const onCompare = (checked: boolean): void => {
    if (checked) {
      onChange({ ...value, compare: "previous" });
      return;
    }
    const { compare: _compare, ...rest } = value;
    onChange(rest);
  };

  return (
    <>
      <label className={labelClass}>
        Range
        <select className={fieldClass} value={value.range} onChange={(event) => onRange(event.target.value as EnergyViewRange)}>
          {ENERGY_RANGES.map((range) => (
            <option key={range.value} value={range.value}>
              {range.label}
            </option>
          ))}
        </select>
      </label>
      {value.range === "custom" ? (
        <>
          <label className={labelClass}>
            From
            <input
              type="datetime-local"
              className={fieldClass}
              disabled={timeZone === null}
              value={timeZone === null ? "" : instantToZoneInput(value.from, timeZone)}
              onChange={(event) => onInstant("from", event.target.value)}
            />
          </label>
          <label className={labelClass}>
            To
            <input
              type="datetime-local"
              className={fieldClass}
              disabled={timeZone === null}
              value={timeZone === null ? "" : instantToZoneInput(value.to, timeZone)}
              onChange={(event) => onInstant("to", event.target.value)}
            />
          </label>
          {timeZone !== null ? <span className="pb-2 text-xs text-ink-muted">{zoneLabel(timeZone)}</span> : null}
        </>
      ) : null}
      <label className="flex items-center gap-2 pb-2 text-sm">
        <input type="checkbox" checked={value.compare === "previous"} onChange={(event) => onCompare(event.target.checked)} />
        Compare with previous period
      </label>
    </>
  );
}
