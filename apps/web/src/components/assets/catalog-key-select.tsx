/**
 * `F4.311` PR 6a (ADR 0109 decision 5) — the catalog key a new standalone
 * calculated point writes, read the way the asset-point wizard reads it
 * (`fetchAdminPointKeys("true")`). The Add panel excludes the keys the asset
 * already has; the batch wizard excludes none (the server names a clash per
 * asset).
 *
 * `F4.313` (ADR 0109 Amendment 1, A11–A12) — with `allowNew`, a last
 * **New key** option (`NEW_KEY`, a value no catalog code can equal). The
 * callers pass it for a global administrator only, the catalog's own write
 * rule; the code, label and unit fields are `NewPointKeyFields`.
 */
import { useQuery } from "@tanstack/react-query";

import { fetchAdminPointKeys } from "../../api/admin/point-keys";
import { NEW_KEY } from "../../lib/new-point-key-draft";

export function CatalogKeySelect({
  value,
  exclude,
  disabled,
  allowNew = false,
  onChange,
}: {
  value: string;
  exclude: ReadonlySet<string>;
  disabled: boolean;
  /** Offer **New key** — a global administrator only (A12). */
  allowNew?: boolean;
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
        {allowNew ? <option value={NEW_KEY}>New key…</option> : null}
      </select>
    </label>
  );
}
