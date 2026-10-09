import { useMemo } from "react";
import type { AccessLocation } from "@bms/shared";

import { interiorNodeIds, locationTreeOptions } from "../lib/location-tree";

type MapSubtreeFilterProps = {
  /** The caller's readable nodes (`/auth/me`'s scope, or one organization's share of it). */
  nodes: readonly AccessLocation[];
  /** The chosen parent's id; `null` shows every pin. */
  value: string | null;
  onChange: (parentLocationId: string | null) => void;
};

/**
 * `F2.10` (ADR 0098 decision 11, B12, B13) — a parent is a filter that zooms the map to its
 * subtree. Offers the nodes that have a child in the list, in tree order with the tree's dashes;
 * a leaf is a pin, not a filter. Renders nothing when no node has a child (B13).
 *
 * Sorted by name first: the asset-group arm of the scope has no `ORDER BY`, and tree order keeps
 * siblings in the input order.
 */
export function MapSubtreeFilter({ nodes, value, onChange }: MapSubtreeFilterProps) {
  const options = useMemo(() => {
    const sorted = [...nodes].sort((a, b) => a.name.localeCompare(b.name));
    const interior = interiorNodeIds(sorted);
    return locationTreeOptions(sorted).filter((option) => interior.has(option.id));
  }, [nodes]);

  if (options.length === 0) {
    return null;
  }
  return (
    <label className="flex items-center gap-2 text-xs font-semibold text-ink-muted">
      Zoom to
      <select
        className="surface-field px-3 py-1.5 text-xs"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">All sites</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
