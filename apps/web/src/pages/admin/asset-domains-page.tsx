import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AdminAssetDomainDto } from "@bms/shared";
import { WORK_ORDER_FALLBACK_PREFIX, WORK_ORDER_PREFIX_PATTERN } from "@bms/shared/contracts";

import { fetchAdminAssetDomains, updateAssetDomainPrefix } from "../../api/admin/asset-domains";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { canManageAssetDomains } from "../../lib/admin-access";
import { apiErrorMessage } from "../../lib/api-error-message";
import type { AuthUser } from "../../stores/auth-store";

type AssetDomainsAdminPageProps = { user: AuthUser };

const DOMAINS_KEY = ["admin", "asset-domains"] as const;

/**
 * `E3.1` (ADR 0122 decision 2.4, rulings P8 and R4) — the global-admin screen for the
 * work-order reference prefix of each asset domain, `bms.asset_domains.work_order_prefix`.
 *
 * **It fails closed at the page.** The route admits every master-data role, but the
 * write is the global `admin`'s alone. For any other role the page renders one status
 * line and mounts no query, so no request is made (the API would answer 403 anyway).
 */
export function AssetDomainsAdminPage({ user }: AssetDomainsAdminPageProps) {
  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Asset Domains"
        subtitle="The work-order reference prefix of each asset domain"
      />
      {canManageAssetDomains(user.role) ? (
        <AssetDomainsCatalog />
      ) : (
        <p role="status" className="text-sm text-ink-muted">
          Asset domains are managed by a global administrator.
        </p>
      )}
    </MasterDataLayout>
  );
}

function AssetDomainsCatalog() {
  const listQ = useQuery({ queryKey: DOMAINS_KEY, queryFn: fetchAdminAssetDomains });

  return (
    <SectionCard title="Asset domains" bodyClassName="p-3 space-y-3">
      <p className="text-sm text-ink-muted">
        A new prefix applies to work orders created from now on. Existing work orders keep their reference.
      </p>
      {listQ.isPending ? <p className="text-sm text-ink-muted">Loading asset domains…</p> : null}
      {listQ.isError ? (
        <p role="alert" className="text-sm text-critical-ink">
          {apiErrorMessage(listQ.error)}
        </p>
      ) : null}
      {listQ.data ? (
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-ink-muted">
              <th className="px-2 py-2">Domain</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Work-order prefix</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {listQ.data.items.map((domain) => (
              // A saved prefix starts the row's draft again from the server.
              <DomainRow key={`${domain.code}:${domain.workOrderPrefix ?? ""}`} domain={domain} />
            ))}
          </tbody>
        </table>
      ) : null}
    </SectionCard>
  );
}

function DomainRow({ domain }: { domain: AdminAssetDomainDto }) {
  const queryClient = useQueryClient();
  const saved = domain.workOrderPrefix ?? "";
  const [value, setValue] = useState(saved);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => updateAssetDomainPrefix(domain.code, value === "" ? null : value),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: DOMAINS_KEY });
    },
    onError: (err: unknown) => setError(apiErrorMessage(err)),
  });

  const valid = value === "" || WORK_ORDER_PREFIX_PATTERN.test(value);
  const changed = value !== saved;
  const hintId = `asset-domain-prefix-${domain.code}-hint`;

  return (
    <tr className="border-b border-well-deep align-top">
      <td className="px-2 py-2">
        <div>{domain.label}</div>
        <div className="font-mono text-xs text-ink-muted">{domain.code}</div>
      </td>
      <td className="px-2 py-2">
        <StatusPill label={domain.active ? "Active" : "Retired"} tone={domain.active ? "ok" : "offline"} />
      </td>
      <td className="px-2 py-2">
        <input
          type="text"
          className="surface-field w-32 px-3 py-2 font-mono text-sm"
          aria-label={`Work-order prefix for ${domain.label}`}
          aria-describedby={hintId}
          value={value}
          maxLength={8}
          onChange={(event) => setValue(event.target.value.toUpperCase())}
        />
        <p id={hintId} className="mt-1 text-xs text-ink-muted">
          {!valid
            ? "Two to eight capital letters or digits."
            : value === ""
              ? `Tickets read ${WORK_ORDER_FALLBACK_PREFIX}-…`
              : null}
        </p>
        {error ? (
          <p role="alert" className="mt-1 text-sm text-critical-ink">
            {error}
          </p>
        ) : null}
      </td>
      <td className="px-2 py-2">
        <button
          type="button"
          className="surface-button px-3 py-2 text-xs font-semibold disabled:opacity-60"
          disabled={save.isPending || !changed || !valid}
          aria-busy={save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </td>
    </tr>
  );
}
