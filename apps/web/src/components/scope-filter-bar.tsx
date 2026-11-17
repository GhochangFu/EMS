import { useId, type ReactNode } from "react";

import type { FilterOptionsResponse } from "@bms/shared/contracts";

import {
  assetGroupOptionLabels,
  SCOPE_FILTER_KEYS,
  scopeFilterChoices,
  type ScopeFilter,
  type ScopeFilterKey,
} from "../lib/scope-filter";

type ScopeFilterBarProps = {
  filter: ScopeFilter;
  options: FilterOptionsResponse | undefined;
  unavailable: boolean;
  onChange: (key: ScopeFilterKey, value: string) => void;
  /**
   * `E1.9b` (ADR 0135 Amendment 8 decision 8) — which pickers to draw, default all four, so
   * `/alarms` and `/rules` are unchanged. The ML pages pass `["organizationId", "locationId"]`.
   */
  pickers?: readonly ScopeFilterKey[];
};

const NO_OPTIONS: FilterOptionsResponse = { organizations: [], locations: [], assetGroups: [], assets: [] };

/** One labelled picker; the label is a sibling, so the select's name is the label alone. */
function Picker({
  label,
  value,
  disabled,
  onChange,
  children,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2 text-xs text-ink-muted">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="surface-field px-3 py-1.5 text-xs text-ink"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
    </div>
  );
}

/**
 * `F4.361` (ADR 0132 decision 6; plan D10, D11, D13) — the Organization, Location, Asset group and
 * Asset pickers of `/alarms` and `/rules`. It draws what `useScopeFilter` holds and reports a
 * choice; the cascade is `lib/scope-filter.ts`. The look follows `HierarchyFilterBar`'s (the
 * mockup has no filter row), with each picker named by a visible label. `/forecasts` and
 * `/anomalies` draw only the first two (`pickers`, `E1.9b`).
 */
export function ScopeFilterBar({ filter, options, unavailable, onChange, pickers = SCOPE_FILTER_KEYS }: ScopeFilterBarProps) {
  const choices = scopeFilterChoices(filter, options ?? NO_OPTIONS);
  const waiting = !options;
  const noOrganization = waiting || !choices.organizationId;
  const groupLabels = assetGroupOptionLabels(choices.assetGroups, options?.locations ?? []);
  const shows = (key: ScopeFilterKey): boolean => pickers.includes(key);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-3">
        {shows("organizationId") ? (
          <Picker
            label="Organization"
            value={choices.organizationId}
            disabled={waiting || choices.organizationLocked}
            onChange={(value) => onChange("organizationId", value)}
          >
            <option value="">All organizations</option>
            {choices.organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.code} · {org.name}
              </option>
            ))}
          </Picker>
        ) : null}
        {shows("locationId") ? (
          <Picker
            label="Location"
            value={filter.locationId ?? ""}
            disabled={noOrganization}
            onChange={(value) => onChange("locationId", value)}
          >
            <option value="">All locations</option>
            {/* ADR 0098 B5: depth-first, one `— ` per level; a node covers its subtree. */}
            {choices.locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.label}
              </option>
            ))}
          </Picker>
        ) : null}
        {shows("assetGroupId") ? (
          <Picker
            label="Asset group"
            value={filter.assetGroupId ?? ""}
            disabled={noOrganization}
            onChange={(value) => onChange("assetGroupId", value)}
          >
            <option value="">All asset groups</option>
            {choices.assetGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {groupLabels.get(group.id)}
              </option>
            ))}
          </Picker>
        ) : null}
        {shows("assetId") ? (
          <Picker
            label="Asset"
            value={filter.assetId ?? ""}
            disabled={noOrganization}
            onChange={(value) => onChange("assetId", value)}
          >
            <option value="">All assets</option>
            {choices.assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.code} · {asset.name}
              </option>
            ))}
          </Picker>
        ) : null}
      </div>
      {unavailable ? (
        <p className="text-xs text-ink-muted">
          Scope filters are unavailable: the filter options could not be loaded.
        </p>
      ) : null}
    </div>
  );
}
