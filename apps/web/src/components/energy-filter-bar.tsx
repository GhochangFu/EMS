import type { EnergyFilterOptions, EnergyViewRange } from "@bms/shared";

import {
  ENERGY_RANGES,
  type EnergyFilterValue,
  instantToZoneInput,
  locationsOfOrganization,
  zoneInputToInstant,
  zoneLabel,
} from "../lib/energy-view-filter";
import { locationTreeOptions } from "../lib/location-tree";

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const labelClass = "grid gap-1 text-xs text-ink-muted";
const fieldClass = "surface-field px-2 py-1.5 text-sm";

type EnergyFilterBarProps = {
  options: EnergyFilterOptions;
  value: EnergyFilterValue;
  onChange: (next: EnergyFilterValue) => void;
  /**
   * The zone of the last `energy/view` response (site, else organization), or
   * `null` before the first answer. The custom pickers read and show wall time
   * in this zone, never the browser's (ADR 0108 Status ruling c), so they wait
   * while it is `null`.
   */
  timeZone: string | null;
  /** Injected for tests; seeds a new custom range with the last 24 h. */
  now?: () => Date;
};

/** A copy of `value` without the custom instants. */
function withoutInstants(value: EnergyFilterValue): EnergyFilterValue {
  const { from: _from, to: _to, ...rest } = value;
  return rest;
}

/**
 * `F4.298` U5 (ADR 0108 decision 2) — the Energy page's filter: organization,
 * then one or more of its locations (a parent includes its children), the
 * range, the custom from/to, and the compare toggle. Controlled.
 *
 * The organization select is the report schedule wizard's shape and shows only
 * for a caller with two or more organizations; the locations `<select multiple>`
 * lists the chosen organization's readable tree, depth-first with `— ` labels
 * (`locationTreeOptions`). The range select sits where the `ESKOM_SMOC.html`
 * `#/energy` header carries its one range control.
 */
export function EnergyFilterBar({ options, value, onChange, timeZone, now = () => new Date() }: EnergyFilterBarProps) {
  const locations = locationTreeOptions(locationsOfOrganization(options, value.organizationId));

  const onRange = (range: EnergyViewRange): void => {
    if (range !== "custom") {
      onChange({ ...withoutInstants(value), range });
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
    <div data-testid="energy-filter-bar" className="flex flex-wrap items-end gap-3">
      {options.organizations.length > 1 ? (
        <label className={labelClass}>
          Organization
          <select
            className={fieldClass}
            value={value.organizationId}
            onChange={(event) => onChange({ ...value, organizationId: event.target.value, locationIds: [] })}
          >
            {options.organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.code} · {organization.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className={labelClass}>
        Locations
        <select
          multiple
          className={fieldClass}
          value={value.locationIds}
          onChange={(event) =>
            onChange({ ...value, locationIds: Array.from(event.target.selectedOptions).map((option) => option.value) })
          }
        >
          {/* `F2.10` (ADR 0098 B11) — the tree depth-first, one `— ` per level. */}
          {locations.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
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
    </div>
  );
}
