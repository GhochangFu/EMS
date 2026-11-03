import type { ReactNode } from "react";

import type { EnergyFilterOptions } from "@bms/shared";

import { type EnergyFilterValue, locationsOfOrganization } from "../lib/energy-view-filter";
import { locationTreeOptions } from "../lib/location-tree";
import { type RangeCompareValue, RangeCompareControls } from "./energy/range-compare-controls";

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
  /** `F4.303`: the view's actions ("Copy link"), rendered at the end of the bar. */
  actions?: ReactNode;
};

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
export function EnergyFilterBar({
  options,
  value,
  onChange,
  timeZone,
  now = () => new Date(),
  actions,
}: EnergyFilterBarProps) {
  const locations = locationTreeOptions(locationsOfOrganization(options, value.organizationId));

  const onRangeCompare = (next: RangeCompareValue): void => {
    const { range: _range, from: _from, to: _to, compare: _compare, ...others } = value;
    onChange({ ...others, ...next });
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
      <RangeCompareControls
        value={{
          range: value.range,
          ...(value.from !== undefined ? { from: value.from } : {}),
          ...(value.to !== undefined ? { to: value.to } : {}),
          ...(value.compare !== undefined ? { compare: value.compare } : {}),
        }}
        onChange={onRangeCompare}
        timeZone={timeZone}
        now={now}
      />
      {actions !== undefined ? <div className="pb-1">{actions}</div> : null}
    </div>
  );
}
