import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import {
  SERVICE_TOKEN_DEFAULT_EXPIRY_DAYS,
  SERVICE_TOKEN_MAX_EXPIRY_DAYS,
  SERVICE_TOKEN_MAX_LIVE,
  type ServiceAccountDto,
  type ServiceAccountRole,
  type ServiceTokenDto,
} from "@bms/shared";

import { fetchAdminAssetGroups } from "../../api/admin/asset-groups";
import { fetchAdminLocations } from "../../api/admin/locations";
import { fetchAdminOrganizations } from "../../api/admin/organizations";
import {
  addServiceAccountGrant,
  createServiceAccount,
  createServiceToken,
  fetchServiceAccounts,
  invalidateServiceAccountReads,
  removeServiceAccountGrant,
  revokeServiceToken,
  serviceAccountsQueryKey,
  updateServiceAccount,
} from "../../api/admin/service-accounts";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { canManageServiceAccounts } from "../../lib/admin-access";
import { apiErrorMessage } from "../../lib/api-error-message";
import type { AuthUser } from "../../stores/auth-store";

/** The fixed sentence beside a new token (ADR 0125 decision 11, AGENTS.md §9.6). */
export const SERVICE_TOKEN_SHOWN_ONCE =
  "This token is shown once. Store it in the integration's secret store now: it cannot be shown again, only " +
  "replaced. Once it is stored, clear your clipboard.";

export const NO_SERVICE_ACCOUNTS = "No service accounts yet. Create one with New service account.";

export const SERVICE_ACCOUNTS_REFUSED = "Service accounts are managed by an administrator or an organization administrator.";

type Dialog =
  | { kind: "create" }
  | { kind: "token"; account: ServiceAccountDto }
  | { kind: "revoke"; account: ServiceAccountDto; token: ServiceTokenDto }
  | { kind: "disable"; account: ServiceAccountDto }
  | { kind: "grants"; account: ServiceAccountDto };

const fieldClass = "mt-1 w-full surface-field px-3 py-2 text-sm";
const labelClass = "block text-xs font-semibold text-ink-muted";
const primaryClass = "surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent";
const secondaryClass = "surface-button px-3 py-2 text-xs";
const actionClass = "text-xs font-semibold text-accent-strong";

/** "2026-11-10 08:12 UTC" — the ISO minute, the same on every machine. */
export function minuteUtc(iso: string | null): string {
  return iso === null ? "Never" : `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/** How many of an account's tokens still authenticate. */
export function liveTokenCount(account: Pick<ServiceAccountDto, "tokens">): number {
  return account.tokens.filter((token) => token.status === "active").length;
}

function escapeAsCancel(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== "Escape") return;
  event.preventDefault();
  const buttons = [...event.currentTarget.querySelectorAll("button")];
  buttons.find((button) => button.textContent === "Cancel" || button.textContent === "Done")?.click();
}

/**
 * `F4.17` / ADR 0125 decision 14 — service accounts for integrations: a
 * `viewer` or `operator` identity per integration, its location and asset
 * group grants, and its tokens (issue, revoke). Fails closed at the page for
 * every role but `admin` and `organization_admin`; every route behind it
 * refuses the others too.
 *
 * **A token is shown once.** It lives only in the token dialog's state and the
 * mutation that fetched it, both cleared when the dialog closes; no query
 * caches it and nothing writes it to storage. Lists show the public token id.
 */
export function ServiceAccountsAdminPage({ user }: { user: AuthUser }) {
  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Service Accounts"
        subtitle="Non-human identities for integrations, with scoped, expiring, revocable tokens"
      />
      {canManageServiceAccounts(user.role) ? (
        <ServiceAccountsCatalog />
      ) : (
        <p role="status" className="text-sm text-ink-muted">
          {SERVICE_ACCOUNTS_REFUSED}
        </p>
      )}
    </MasterDataLayout>
  );
}

function ServiceAccountsCatalog() {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const listQ = useQuery({ queryKey: serviceAccountsQueryKey, queryFn: fetchServiceAccounts });
  const items = listQ.data?.items ?? [];
  const close = () => setDialog(null);
  return (
    <>
      <SectionCard title="Service accounts" bodyClassName="p-3 space-y-3">
        <p className="text-xs text-ink-muted">
          A service account is a viewer or an operator: it reads, or acknowledges and operates, within its grants, and
          never administers. A token expires; issue the new one before revoking the old. Disabling an account revokes
          every token it holds.
        </p>
        <div className="flex justify-end">
          <button type="button" className={primaryClass} onClick={() => setDialog({ kind: "create" })}>
            New service account
          </button>
        </div>
        {listQ.isError ? (
          <p role="alert" className="text-xs text-critical-ink">
            {apiErrorMessage(listQ.error)}
          </p>
        ) : null}
        {listQ.isPending ? (
          <p role="status" className="text-xs text-ink-muted">
            Loading service accounts…
          </p>
        ) : null}
        {listQ.isSuccess && items.length === 0 ? <p className="text-sm text-ink-muted">{NO_SERVICE_ACCOUNTS}</p> : null}
        {items.map((account) => (
          <AccountCard key={account.id} account={account} open={setDialog} />
        ))}
      </SectionCard>
      {dialog !== null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4">
          {dialog.kind === "create" ? (
            <CreateDialog onClose={close} />
          ) : dialog.kind === "token" ? (
            <TokenDialog account={dialog.account} onClose={close} />
          ) : dialog.kind === "revoke" ? (
            <RevokeDialog account={dialog.account} token={dialog.token} onClose={close} />
          ) : dialog.kind === "disable" ? (
            <DisableDialog account={dialog.account} onClose={close} />
          ) : (
            <GrantsDialog accountId={dialog.account.id} onClose={close} />
          )}
        </div>
      ) : null}
    </>
  );
}

function AccountCard({ account, open }: { account: ServiceAccountDto; open: (next: Dialog) => void }) {
  const queryClient = useQueryClient();
  const enabled = account.disabledAt === null;
  const enableM = useMutation({
    mutationFn: async () => updateServiceAccount(account.id, { disabled: false }),
    onSuccess: async () => invalidateServiceAccountReads(queryClient),
  });
  const full = liveTokenCount(account) >= SERVICE_TOKEN_MAX_LIVE;
  return (
    <article aria-label={`Service account ${account.name}`} className="space-y-2 border-b border-well-deep pb-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">{account.name}</h3>
        <StatusPill label={account.role === "operator" ? "Operator" : "Viewer"} tone="ok" />
        {enabled ? null : <StatusPill label="Disabled" tone="offline" />}
        <span className="text-xs text-ink-muted">{`Grants: ${account.grants.map((g) => g.targetName).join(", ") || "none — it sees nothing yet"}`}</span>
      </div>
      <div className="flex flex-wrap gap-3">
        {enabled ? (
          <>
            <button
              type="button"
              className={actionClass}
              disabled={full}
              title={full ? `At most ${SERVICE_TOKEN_MAX_LIVE} live tokens; revoke one first` : undefined}
              onClick={() => open({ kind: "token", account })}
            >
              New token
            </button>
            <button type="button" className={actionClass} onClick={() => open({ kind: "grants", account })}>
              Grants
            </button>
            <button type="button" className="text-xs font-semibold text-critical-ink" onClick={() => open({ kind: "disable", account })}>
              Disable
            </button>
          </>
        ) : (
          <button
            type="button"
            className={actionClass}
            disabled={enableM.isPending}
            aria-busy={enableM.isPending}
            onClick={() => enableM.mutate()}
          >
            {enableM.isPending ? "Enabling…" : "Enable"}
          </button>
        )}
      </div>
      {enableM.error ? (
        <p role="alert" className="text-xs text-critical-ink">
          {apiErrorMessage(enableM.error)}
        </p>
      ) : null}
      {account.tokens.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-ink-muted">
                <th className="px-2 py-1">Token</th>
                <th className="px-2 py-1">Name</th>
                <th className="px-2 py-1">Access</th>
                <th className="px-2 py-1">Status</th>
                <th className="px-2 py-1">Expires</th>
                <th className="px-2 py-1">Last used</th>
                <th className="px-2 py-1">Actions</th>
              </tr>
            </thead>
            <tbody>
              {account.tokens.map((token) => (
                <tr key={token.id} className="border-b border-well-deep">
                  <td className="px-2 py-1 font-mono text-xs">{`bms_sat_${token.tokenId}_…`}</td>
                  <td className="px-2 py-1">{token.name}</td>
                  <td className="px-2 py-1 text-xs">{token.readOnly ? "Read-only" : "Read and write"}</td>
                  <td className="px-2 py-1">
                    <StatusPill
                      label={token.status === "active" ? "Active" : token.status === "revoked" ? "Revoked" : "Expired"}
                      tone={token.status === "active" ? "ok" : "offline"}
                    />
                  </td>
                  <td className="px-2 py-1 font-mono text-xs">{minuteUtc(token.expiresAt)}</td>
                  <td className="px-2 py-1 font-mono text-xs">{minuteUtc(token.lastUsedAt)}</td>
                  <td className="px-2 py-1">
                    {token.status === "active" ? (
                      <button
                        type="button"
                        aria-label={`Revoke token ${token.tokenId}`}
                        className="text-xs font-semibold text-critical-ink"
                        onClick={() => open({ kind: "revoke", account, token })}
                      >
                        Revoke
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </article>
  );
}

function DialogFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="max-h-[90vh] w-full max-w-xl space-y-3 overflow-y-auto surface-dialog p-4"
      onKeyDown={escapeAsCancel}
    >
      <h2 className="text-sm font-semibold text-ink">{label}</h2>
      {children}
    </div>
  );
}

function ErrorLine({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="text-xs text-critical-ink">
      {apiErrorMessage(error)}
    </p>
  ) : null;
}

function Buttons({ onCancel, children }: { onCancel: () => void; children: ReactNode }) {
  return (
    <div className="flex justify-end gap-2">
      <button type="button" className={secondaryClass} onClick={onCancel}>
        Cancel
      </button>
      {children}
    </div>
  );
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [organizationId, setOrganizationId] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<ServiceAccountRole>("viewer");
  const organizationsQ = useQuery({ queryKey: ["admin", "organizations", "true"], queryFn: () => fetchAdminOrganizations("true") });
  const createM = useMutation({
    mutationFn: async () => createServiceAccount({ organizationId, name: name.trim(), role }),
    onSuccess: async () => {
      await invalidateServiceAccountReads(queryClient);
      onClose();
    },
  });
  const ready = organizationId !== "" && name.trim() !== "";
  return (
    <DialogFrame label="New service account">
      <label className={labelClass}>
        Organization
        <select className={fieldClass} value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>
          <option value="">Choose an organization</option>
          {(organizationsQ.data?.items ?? []).map((organization) => (
            <option key={organization.id} value={organization.id}>
              {`${organization.code} — ${organization.name}`}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Name
        <input className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className={labelClass}>
        Role
        <select className={fieldClass} value={role} onChange={(event) => setRole(event.target.value as ServiceAccountRole)}>
          <option value="viewer">Viewer — reads only</option>
          <option value="operator">Operator — reads, acknowledges and operates</option>
        </select>
      </label>
      <ErrorLine error={createM.error} />
      <Buttons onCancel={onClose}>
        <button
          type="button"
          className={primaryClass}
          disabled={!ready || createM.isPending}
          aria-busy={createM.isPending}
          onClick={() => createM.mutate()}
        >
          {createM.isPending ? "Creating…" : "Create"}
        </button>
      </Buttons>
    </DialogFrame>
  );
}

function TokenDialog({ account, onClose }: { account: ServiceAccountDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [days, setDays] = useState(String(SERVICE_TOKEN_DEFAULT_EXPIRY_DAYS));
  const [readOnly, setReadOnly] = useState(account.role === "viewer");
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const issueM = useMutation({
    mutationFn: async () => createServiceToken(account.id, { name: name.trim(), expiresInDays: Number(days), readOnly }),
    gcTime: 0,
    onSuccess: async () => invalidateServiceAccountReads(queryClient),
  });
  const token = issueM.data?.token ?? null;
  const daysValid = /^\d+$/.test(days) && Number(days) >= 1 && Number(days) <= SERVICE_TOKEN_MAX_EXPIRY_DAYS;
  const done = () => {
    issueM.reset();
    onClose();
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token ?? "");
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  };
  return (
    <DialogFrame label={`New token for ${account.name}`}>
      {token === null ? (
        <>
          <label className={labelClass}>
            Name
            <input className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className={labelClass}>
            {`Expires in (days, 1–${SERVICE_TOKEN_MAX_EXPIRY_DAYS})`}
            <input className={fieldClass} inputMode="numeric" value={days} onChange={(event) => setDays(event.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={readOnly} onChange={(event) => setReadOnly(event.target.checked)} />
            Read-only (every write is refused)
          </label>
          <ErrorLine error={issueM.error} />
          <Buttons onCancel={done}>
            <button
              type="button"
              className={primaryClass}
              disabled={name.trim() === "" || !daysValid || issueM.isPending}
              aria-busy={issueM.isPending}
              onClick={() => issueM.mutate()}
            >
              {issueM.isPending ? "Issuing…" : "Issue token"}
            </button>
          </Buttons>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold">{SERVICE_TOKEN_SHOWN_ONCE}</p>
          <input
            aria-label="Service token"
            readOnly
            autoComplete="off"
            spellCheck={false}
            className="w-full surface-field px-2 py-1 font-mono text-xs"
            value={token}
            onFocus={(event) => event.currentTarget.select()}
          />
          {copied === "yes" ? <p className="text-xs text-ink-muted">Copied.</p> : null}
          {copied === "failed" ? <p className="text-xs text-critical-ink">Copy failed: select the token and copy it by hand.</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className={secondaryClass} onClick={() => void copy()}>
              Copy token
            </button>
            <button type="button" className={secondaryClass} onClick={done}>
              Done
            </button>
          </div>
        </>
      )}
    </DialogFrame>
  );
}

function RevokeDialog({ account, token, onClose }: { account: ServiceAccountDto; token: ServiceTokenDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const revokeM = useMutation({
    mutationFn: async () => revokeServiceToken(account.id, token.id),
    onSuccess: async () => {
      await invalidateServiceAccountReads(queryClient);
      onClose();
    },
  });
  return (
    <DialogFrame label="Revoke token">
      <p className="text-sm">{`Revoke ${token.name} (bms_sat_${token.tokenId}_…)? It stops working at once, on every server. Revocation is final.`}</p>
      <ErrorLine error={revokeM.error} />
      <Buttons onCancel={onClose}>
        <button
          type="button"
          className={secondaryClass}
          disabled={revokeM.isPending}
          aria-busy={revokeM.isPending}
          onClick={() => revokeM.mutate()}
        >
          {revokeM.isPending ? "Revoking…" : "Revoke"}
        </button>
      </Buttons>
    </DialogFrame>
  );
}

function DisableDialog({ account, onClose }: { account: ServiceAccountDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const disableM = useMutation({
    mutationFn: async () => updateServiceAccount(account.id, { disabled: true }),
    onSuccess: async () => {
      await invalidateServiceAccountReads(queryClient);
      onClose();
    },
  });
  return (
    <DialogFrame label="Disable service account">
      <p className="text-sm">{`Disable ${account.name}? Every token it holds is revoked at once; enabling it again restores none of them.`}</p>
      <ErrorLine error={disableM.error} />
      <Buttons onCancel={onClose}>
        <button
          type="button"
          className={secondaryClass}
          disabled={disableM.isPending}
          aria-busy={disableM.isPending}
          onClick={() => disableM.mutate()}
        >
          {disableM.isPending ? "Disabling…" : "Disable"}
        </button>
      </Buttons>
    </DialogFrame>
  );
}

function GrantsDialog({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const listQ = useQuery({ queryKey: serviceAccountsQueryKey, queryFn: fetchServiceAccounts });
  const account = listQ.data?.items.find((item) => item.id === accountId);
  const organizationId = account?.organizationId ?? "";
  const [target, setTarget] = useState("");
  const locationsQ = useQuery({
    queryKey: ["admin", "locations", "true", organizationId],
    queryFn: () => fetchAdminLocations("true", organizationId),
    enabled: organizationId !== "",
  });
  const groupsQ = useQuery({ queryKey: ["admin", "asset-groups", "all"], queryFn: () => fetchAdminAssetGroups() });
  const groups = (groupsQ.data?.items ?? []).filter((group) => group.organizationId === organizationId);
  const addM = useMutation({
    mutationFn: async () => {
      const [kind, targetId] = target.split(":") as ["location" | "asset_group", string];
      return addServiceAccountGrant(accountId, { kind, targetId });
    },
    onSuccess: async () => {
      setTarget("");
      await invalidateServiceAccountReads(queryClient);
    },
  });
  const removeM = useMutation({
    mutationFn: async ({ kind, id }: { kind: string; id: string }) => removeServiceAccountGrant(accountId, kind, id),
    onSuccess: async () => invalidateServiceAccountReads(queryClient),
  });
  return (
    <DialogFrame label={`Grants of ${account?.name ?? "service account"}`}>
      <p className="text-xs text-ink-muted">A service account sees only the locations and asset groups granted here.</p>
      <ul className="space-y-1 text-sm">
        {(account?.grants ?? []).map((grant) => (
          <li key={grant.id} className="flex items-center justify-between gap-2">
            <span>{`${grant.kind === "location" ? "Location" : "Asset group"}: ${grant.targetName}`}</span>
            <button
              type="button"
              aria-label={`${removeM.isPending ? "Removing" : "Remove"} grant ${grant.targetName}`}
              className="text-xs font-semibold text-critical-ink"
              disabled={removeM.isPending}
              aria-busy={removeM.isPending}
              onClick={() => removeM.mutate({ kind: grant.kind, id: grant.id })}
            >
              {removeM.isPending ? "Removing…" : "Remove"}
            </button>
          </li>
        ))}
      </ul>
      <label className={labelClass}>
        Add a grant
        <select className={fieldClass} value={target} onChange={(event) => setTarget(event.target.value)}>
          <option value="">Choose a location or asset group</option>
          {(locationsQ.data?.items ?? []).map((location) => (
            <option key={location.id} value={`location:${location.id}`}>
              {`Location — ${location.name}`}
            </option>
          ))}
          {groups.map((group) => (
            <option key={group.id} value={`asset_group:${group.id}`}>
              {`Asset group — ${group.name}`}
            </option>
          ))}
        </select>
      </label>
      <ErrorLine error={addM.error ?? removeM.error} />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className={primaryClass}
          disabled={target === "" || addM.isPending}
          aria-busy={addM.isPending}
          onClick={() => addM.mutate()}
        >
          {addM.isPending ? "Adding…" : "Add grant"}
        </button>
        <button type="button" className={secondaryClass} onClick={onClose}>
          Done
        </button>
      </div>
    </DialogFrame>
  );
}
