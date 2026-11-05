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
 *
 * `F4.313` follow-up (owner ruling 2026-11-05) — domain first: with a
 * `domain`, the list holds that domain's keys (and the keys with no domain,
 * as **New key** creates them) until **Show all keys** is ticked, and a search box narrows it by code or name
 * (`lib/catalog-key-filter.ts`). With `domain` `null` every key is listed and
 * the toggle is not shown. **New key** is offered in every mode.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { fetchAdminPointKeys } from "../../api/admin/point-keys";
import { visibleCatalogKeys } from "../../lib/catalog-key-filter";
import { NEW_KEY } from "../../lib/new-point-key-draft";

export function CatalogKeySelect({
  value,
  exclude,
  disabled,
  allowNew = false,
  domain = null,
  onChange,
}: {
  value: string;
  exclude: ReadonlySet<string>;
  disabled: boolean;
  /** Offer **New key** — a global administrator only (A12). */
  allowNew?: boolean;
  /** The asset's (assets' shared) domain; `null` lists every key. */
  domain?: string | null;
  onChange: (pointKey: string) => void;
}) {
  // `F3.39`: one fleet-wide catalog, so no organization in the key.
  const catalogQ = useQuery({ queryKey: ["admin", "point-keys", "true"], queryFn: () => fetchAdminPointKeys("true") });
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");
  const items = visibleCatalogKeys(catalogQ.data?.items ?? [], { exclude, domain, showAll, search, selected: value });
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-end gap-3 text-xs">
        <label className="block flex-1">
          <span className="text-ink-muted">Search</span>
          <input
            type="search"
            aria-label="Search point keys"
            value={search}
            disabled={disabled}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Code or name"
            className="mt-1 w-full surface-field px-2 py-1"
          />
        </label>
        {domain !== null ? (
          <label className="flex items-center gap-1 pb-1">
            <input
              type="checkbox"
              checked={showAll}
              disabled={disabled}
              onChange={(event) => setShowAll(event.target.checked)}
            />
            <span>Show all keys</span>
          </label>
        ) : null}
      </div>
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
          {items.map((item) => (
            <option key={item.id} value={item.code}>
              {item.code} · {item.name}
            </option>
          ))}
          {allowNew ? <option value={NEW_KEY}>New key…</option> : null}
        </select>
      </label>
    </div>
  );
}
