/**
 * `F4.311` PR 6a (ADR 0109 decision 5) — the catalog key a new standalone
 * calculated point writes, read the way the asset-point wizard reads it
 * (`fetchAdminPointKeys("true")`). The Add panel excludes the keys the asset
 * already has; the batch wizard excludes none (the server names a clash per
 * asset).
 */
import { useQuery } from "@tanstack/react-query";

import { fetchAdminPointKeys } from "../../api/admin/point-keys";

export function CatalogKeySelect({
  value,
  exclude,
  disabled,
  onChange,
}: {
  value: string;
  exclude: ReadonlySet<string>;
  disabled: boolean;
  onChange: (pointKey: string) => void;
}) {
  // `F3.39`: one fleet-wide catalog, so no organization in the key.
  const catalogQ = useQuery({ queryKey: ["admin", "point-keys", "true"], queryFn: () => fetchAdminPointKeys("true") });
  return (
    <label className="block text-xs">
      <span className="text-ink-muted">Point key</span>
      <select
        aria-label="Point key"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full surface-field px-2 py-1"
      >
        <option value="">Select catalog point key</option>
        {(catalogQ.data?.items ?? [])
          .filter((item) => !exclude.has(item.code))
          .map((item) => (
            <option key={item.id} value={item.code}>
              {item.code} · {item.name}
            </option>
          ))}
      </select>
    </label>
  );
}
