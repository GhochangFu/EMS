import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { fetchAssets } from "../api/assets";
import { fetchVocabularies, vocabulariesQueryKey } from "../api/vocabularies";
import { apiErrorMessage } from "../lib/api-error-message";
import {
  activeLabel,
  domainLabel,
  filterAssetRows,
  siteOptions,
} from "../lib/asset-browser";
import { AppShell } from "../layouts/app-shell";
import { AssetDetailPanel } from "../components/assets/asset-detail-panel";
import { PageHeader } from "../components/page-header";
import { SectionCard } from "../components/section-card";
import { StatusPill } from "../components/status-pill";
import type { AuthUser } from "../stores/auth-store";

type AssetsPageProps = {
  user: AuthUser;
};

/** A null RTU or source reads the em dash the rest of the UI uses for "nothing to show". */
const NONE = "—";

/**
 * `F3.31` — the operator-facing Assets browser at `/asset-browser` (ADR 0068
 * decisions 1, 3 and 5; ruling 8 for the path — `/assets` is Vite's build
 * output directory, and nginx answers 301 → 403 for it before the SPA loads).
 *
 * **This file shares its basename with `pages/admin/assets-page.tsx` and is
 * not that page.** ADR 0068 Q2 ruled a NEW read-only route over a scoped view
 * of `/admin/assets`: that page is a master-data editor (create/edit form,
 * RTU attach, points navigation) rendered inside `MasterDataLayout`, whose
 * tab strip and access predicate are both master-data-shaped. This one
 * renders in `AppShell` directly, carries no write affordance, and applies no
 * client-side role predicate (decision 5): `GET /assets` already scopes the
 * rows to the caller's `readableAssetIds`, and the page renders what it
 * returns — ADR 0047 Amendment 4's rule.
 *
 * A table with client-side filters over the one unpaginated list response
 * (decision 1): text on code and name, a domain select fed by the
 * vocabulary, a site select over `siteName`. Clicking a row's code opens the
 * detail panel beside the table (ruling 5 — a side panel, not a route).
 */
export function AssetsPage({ user }: AssetsPageProps) {
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState("");
  const [site, setSite] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["assets", "list"],
    queryFn: () => fetchAssets(),
  });
  // Same key and staleTime as the admin assets form (ADR 0031 Amendment 1):
  // one nine-row payload, one cache entry.
  const vocabQ = useQuery({
    queryKey: vocabulariesQueryKey,
    queryFn: fetchVocabularies,
    staleTime: 5 * 60 * 1000,
  });
  const assetDomains = vocabQ.data?.assetDomains ?? [];

  const rows = listQ.data ?? [];
  const filtered = useMemo(
    () => filterAssetRows(rows, { query, domain, site }),
    [rows, query, domain, site],
  );
  const sites = useMemo(() => siteOptions(rows), [rows]);
  const selected = selectedId === null ? null : rows.find((row) => row.id === selectedId) ?? null;

  return (
    <AppShell user={user} kpiRibbon={<span className="text-bms-ink">Assets</span>}>
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        <PageHeader
          eyebrow="Operations"
          title="Assets"
          subtitle="Every asset in your scope, with its gateway, telemetry source and default dashboards"
        />

        {listQ.isLoading ? <p className="text-sm text-bms-muted">Loading assets…</p> : null}
        {listQ.isError ? (
          <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {apiErrorMessage(listQ.error as Error)}
          </p>
        ) : null}

        {!listQ.isLoading && !listQ.isError && rows.length === 0 ? (
          <p className="rounded border border-dashed border-gray-300 p-4 text-xs text-bms-muted">
            No assets are readable in your current scope yet.
          </p>
        ) : null}

        {rows.length > 0 ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                aria-label="Filter by code or name"
                placeholder="Filter by code or name"
                className="w-64 rounded border border-gray-300 px-3 py-1.5 text-sm"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <select
                aria-label="Domain"
                className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
              >
                <option value="">All domains</option>
                {assetDomains.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Site"
                className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                value={site}
                onChange={(event) => setSite(event.target.value)}
              >
                <option value="">All sites</option>
                {sites.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <span className="text-xs text-bms-muted">
                {filtered.length} of {rows.length}
              </span>
            </div>

            <SectionCard bodyClassName="overflow-x-auto p-0">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-gray-100 bg-gray-50 text-[11px] font-semibold uppercase tracking-wide text-bms-muted">
                  <tr>
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Site</th>
                    <th className="px-3 py-2">Domain</th>
                    <th className="px-3 py-2">RTU</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr
                      key={row.id}
                      className={`border-b border-gray-100 ${row.id === selectedId ? "bg-bms-canvas/80" : ""}`}
                    >
                      <td className="px-3 py-2 font-mono text-xs">
                        <button
                          type="button"
                          className="font-semibold text-bms-green hover:underline"
                          onClick={() => setSelectedId(row.id)}
                        >
                          {row.code}
                        </button>
                      </td>
                      <td className="px-3 py-2 font-medium">{row.name}</td>
                      <td className="px-3 py-2 text-xs text-bms-muted">{row.siteName}</td>
                      <td className="px-3 py-2 text-xs">{domainLabel(row.domain, assetDomains)}</td>
                      <td className="px-3 py-2 text-xs">{row.rtuDisplayName ?? NONE}</td>
                      <td className="px-3 py-2 text-xs">{row.telemetrySource ?? NONE}</td>
                      <td className="px-3 py-2">
                        <StatusPill label={activeLabel(row.active)} tone={row.active ? "ok" : "offline"} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>
          </>
        ) : null}
      </div>

      {selected !== null ? (
        <AssetDetailPanel
          asset={selected}
          domainLabel={domainLabel(selected.domain, assetDomains)}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </AppShell>
  );
}
