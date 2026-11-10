import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import type { EdgeGatewayDto } from "@bms/shared";

import {
  createEdgeGateway,
  edgeGatewaysQueryKey,
  fetchEdgeGateways,
  invalidateEdgeGatewayReads,
  mintEdgeGatewayToken,
  putEdgeGatewayRtus,
  revokeEdgeGateway,
  updateEdgeGateway,
} from "../../api/admin/edge-gateways";
import { fetchAdminLocations } from "../../api/admin/locations";
import { fetchAdminOrganizations } from "../../api/admin/organizations";
import { fetchAdminRtus } from "../../api/admin/rtus";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { canManageEdgeGateways } from "../../lib/admin-access";
import { apiErrorMessage } from "../../lib/api-error-message";
import type { AuthUser } from "../../stores/auth-store";

/** The fixed sentence beside a minted token (ADR 0123 decision 5, §9.6). */
export const TOKEN_SHOWN_ONCE =
  "This token is shown once. Put it in the box's EDGE_GATEWAY_TOKEN now: it cannot be shown again, only replaced.";

type Dialog =
  | { kind: "create" }
  | { kind: "rename"; gateway: EdgeGatewayDto }
  | { kind: "revoke"; gateway: EdgeGatewayDto }
  | { kind: "token"; gateway: EdgeGatewayDto }
  | { kind: "rtus"; gateway: EdgeGatewayDto };

/** "2026-11-10 08:12 UTC" — the ISO minute, the same on every machine (the `keySetLine` rule). */
export function minuteUtc(iso: string | null): string {
  return iso === null ? "Never" : `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/** "Token ends in …abcd, rotated 2026-11-09", or "No token". Never more of the token. */
export function tokenLine(gateway: Pick<EdgeGatewayDto, "tokenLast4" | "tokenRotatedAt">): string {
  if (gateway.tokenLast4 === null) return "No token";
  const rotated = gateway.tokenRotatedAt === null ? "" : `, rotated ${gateway.tokenRotatedAt.slice(0, 10)}`;
  return `Token ends in …${gateway.tokenLast4}${rotated}`;
}

/** Escape presses the dialog's own Cancel (the Payload Formats page's rule). */
function escapeAsCancel(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== "Escape") return;
  event.preventDefault();
  const buttons = [...event.currentTarget.querySelectorAll("button")];
  buttons.find((button) => button.textContent === "Cancel" || button.textContent === "Done")?.click();
}

const fieldClass = "mt-1 w-full surface-field px-3 py-2 text-sm";
const labelClass = "block text-xs font-semibold text-ink-muted";
const primaryClass = "surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent";
const secondaryClass = "surface-button px-3 py-2 text-xs";

/**
 * `E7.2` / ADR 0123 decision 12 (plan T6.3) — the site edge gateways: create, rename, mint or
 * rotate a token, assign RTUs, revoke. Fails closed at the page for any role but the global
 * `admin` (the Payload Formats rule); every route behind it refuses the others too.
 *
 * **The token is shown once.** It lives only in the token dialog's state and the mutation that
 * fetched it, both cleared when the dialog closes; no query caches it and nothing writes it to
 * storage. The table shows its last four characters and when it was rotated.
 */
export function EdgeGatewaysAdminPage({ user }: { user: AuthUser }) {
  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Edge Gateways"
        subtitle="Site boxes that buffer telemetry while the uplink is down and forward it to the cloud"
      />
      {canManageEdgeGateways(user.role) ? (
        <EdgeGatewaysCatalog />
      ) : (
        <p role="status" className="text-sm text-ink-muted">
          Edge gateways are managed by a global administrator.
        </p>
      )}
    </MasterDataLayout>
  );
}

function EdgeGatewaysCatalog() {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const listQ = useQuery({ queryKey: edgeGatewaysQueryKey, queryFn: fetchEdgeGateways });
  const items = listQ.data ?? [];
  const close = () => setDialog(null);

  return (
    <>
      <SectionCard title="Edge gateways" bodyClassName="p-3 space-y-3">
        <p className="text-xs text-ink-muted">
          Assign an RTU before its box goes live: samples for an RTU the gateway does not serve are dropped. Revoke is
          final, and returns the gateway&apos;s RTUs to the cloud.
        </p>
        <div className="flex justify-end">
          <button type="button" className={primaryClass} onClick={() => setDialog({ kind: "create" })}>
            New gateway
          </button>
        </div>
        {listQ.isError ? (
          <p role="alert" className="text-xs text-critical-ink">
            {apiErrorMessage(listQ.error)}
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-ink-muted">
                <th className="px-2 py-2">Code</th>
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Organization</th>
                <th className="px-2 py-2">Location</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Last seen</th>
                <th className="px-2 py-2">Backlog</th>
                <th className="px-2 py-2">Clock</th>
                <th className="px-2 py-2">Token</th>
                <th className="px-2 py-2">RTUs</th>
                <th className="px-2 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((gateway) => (
                <GatewayRow key={gateway.id} gateway={gateway} open={setDialog} />
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {dialog !== null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4">
          {dialog.kind === "create" ? (
            <CreateDialog onClose={close} />
          ) : dialog.kind === "rename" ? (
            <RenameDialog gateway={dialog.gateway} onClose={close} />
          ) : dialog.kind === "revoke" ? (
            <RevokeDialog gateway={dialog.gateway} onClose={close} />
          ) : dialog.kind === "token" ? (
            <TokenDialog gateway={dialog.gateway} onClose={close} />
          ) : (
            <RtusDialog gateway={dialog.gateway} onClose={close} />
          )}
        </div>
      ) : null}
    </>
  );
}

function GatewayRow({ gateway, open }: { gateway: EdgeGatewayDto; open: (next: Dialog) => void }) {
  const active = gateway.status === "active";
  const action = "text-xs font-semibold text-accent-strong";
  return (
    <tr className="border-b border-well-deep">
      <td className="px-2 py-2 font-mono">{gateway.code}</td>
      <td className="px-2 py-2">{gateway.name}</td>
      <td className="px-2 py-2">{gateway.organizationCode}</td>
      <td className="px-2 py-2">{gateway.locationName ?? "—"}</td>
      <td className="px-2 py-2">
        <StatusPill label={active ? "Active" : "Revoked"} tone={active ? "ok" : "offline"} />
      </td>
      <td className="px-2 py-2 font-mono text-xs">{minuteUtc(gateway.lastSeenAt)}</td>
      <td className="px-2 py-2 font-mono">{gateway.reportedBacklog === null ? "—" : String(gateway.reportedBacklog)}</td>
      <td className="px-2 py-2">
        {gateway.clockState === "unsynced" ? (
          <StatusPill label="Unsynced" tone="warning" />
        ) : gateway.clockState === "synced" ? (
          "Synced"
        ) : (
          "—"
        )}
      </td>
      <td className="px-2 py-2 text-xs">{tokenLine(gateway)}</td>
      <td className="px-2 py-2 font-mono">{String(gateway.rtuCount)}</td>
      <td className="px-2 py-2">
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-label={`Rename ${gateway.code}`} className={action} onClick={() => open({ kind: "rename", gateway })}>
            Rename
          </button>
          {active ? (
            <>
              <button type="button" aria-label={`RTUs of ${gateway.code}`} className={action} onClick={() => open({ kind: "rtus", gateway })}>
                RTUs
              </button>
              <button
                type="button"
                aria-label={`${gateway.tokenLast4 === null ? "Mint" : "Rotate"} token for ${gateway.code}`}
                className={action}
                onClick={() => open({ kind: "token", gateway })}
              >
                {gateway.tokenLast4 === null ? "Mint token" : "Rotate token"}
              </button>
              <button
                type="button"
                aria-label={`Revoke ${gateway.code}`}
                className="text-xs font-semibold text-critical-ink"
                onClick={() => open({ kind: "revoke", gateway })}
              >
                Revoke
              </button>
            </>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function DialogFrame({ label, onKeyDown, children }: { label: string; onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void; children: ReactNode }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="max-h-[90vh] w-full max-w-xl space-y-3 overflow-y-auto surface-dialog p-4"
      onKeyDown={onKeyDown ?? escapeAsCancel}
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

/** The location select for one organization; "No location" is `null`. */
function LocationSelect({ organizationId, value, onChange }: { organizationId: string; value: string | null; onChange: (next: string | null) => void }) {
  const locationsQ = useQuery({
    queryKey: ["admin", "locations", "true", organizationId],
    queryFn: () => fetchAdminLocations("true", organizationId),
    enabled: organizationId !== "",
  });
  return (
    <label className={labelClass}>
      Location
      <select className={fieldClass} value={value ?? ""} onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}>
        <option value="">No location</option>
        {(locationsQ.data?.items ?? []).map((location) => (
          <option key={location.id} value={location.id}>
            {location.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [organizationId, setOrganizationId] = useState("");
  const [locationId, setLocationId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const organizationsQ = useQuery({ queryKey: ["admin", "organizations", "true"], queryFn: () => fetchAdminOrganizations("true") });
  const createM = useMutation({
    mutationFn: async () =>
      createEdgeGateway({ organizationId, ...(locationId === null ? {} : { locationId }), code: code.trim(), name: name.trim() }),
    onSuccess: async () => {
      await invalidateEdgeGatewayReads(queryClient);
      onClose();
    },
  });
  const ready = organizationId !== "" && code.trim() !== "" && name.trim() !== "";
  return (
    <DialogFrame label="New edge gateway">
      <label className={labelClass}>
        Organization
        <select
          className={fieldClass}
          value={organizationId}
          onChange={(event) => {
            setOrganizationId(event.target.value);
            setLocationId(null);
          }}
        >
          <option value="">Choose an organization</option>
          {(organizationsQ.data?.items ?? []).map((organization) => (
            <option key={organization.id} value={organization.id}>
              {`${organization.code} — ${organization.name}`}
            </option>
          ))}
        </select>
      </label>
      {organizationId !== "" ? <LocationSelect organizationId={organizationId} value={locationId} onChange={setLocationId} /> : null}
      <label className={labelClass}>
        Code
        <input className={fieldClass} value={code} onChange={(event) => setCode(event.target.value)} />
      </label>
      <label className={labelClass}>
        Name
        <input className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <ErrorLine error={createM.error} />
      <div className="flex justify-end gap-2">
        <button type="button" className={secondaryClass} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={primaryClass}
          disabled={!ready || createM.isPending}
          aria-busy={createM.isPending}
          onClick={() => createM.mutate()}
        >
          {createM.isPending ? "Creating…" : "Create gateway"}
        </button>
      </div>
    </DialogFrame>
  );
}

function RenameDialog({ gateway, onClose }: { gateway: EdgeGatewayDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(gateway.name);
  const [locationId, setLocationId] = useState<string | null>(gateway.locationId);
  const renameM = useMutation({
    mutationFn: async () => updateEdgeGateway(gateway.id, { name: name.trim(), locationId }),
    onSuccess: async () => {
      await invalidateEdgeGatewayReads(queryClient);
      onClose();
    },
  });
  return (
    <DialogFrame label="Rename edge gateway">
      <p className="text-xs text-ink-muted">
        Code <span className="font-mono">{gateway.code}</span> cannot be changed.
      </p>
      <label className={labelClass}>
        Name
        <input className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <LocationSelect organizationId={gateway.organizationId} value={locationId} onChange={setLocationId} />
      <ErrorLine error={renameM.error} />
      <div className="flex justify-end gap-2">
        <button type="button" className={secondaryClass} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={secondaryClass}
          disabled={name.trim() === "" || renameM.isPending}
          aria-busy={renameM.isPending}
          onClick={() => renameM.mutate()}
        >
          {renameM.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </DialogFrame>
  );
}

function RevokeDialog({ gateway, onClose }: { gateway: EdgeGatewayDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const revokeM = useMutation({
    mutationFn: async () => revokeEdgeGateway(gateway.id),
    onSuccess: async () => {
      await invalidateEdgeGatewayReads(queryClient);
      onClose();
    },
  });
  return (
    <DialogFrame label="Revoke edge gateway">
      <p className="text-sm">
        {`Revoke ${gateway.code}? Its token stops working and its ${gateway.rtuCount} RTU(s) return to the cloud. Revoke is final: the gateway can never hold a token again.`}
      </p>
      <ErrorLine error={revokeM.error} />
      <div className="flex justify-end gap-2">
        <button type="button" className={secondaryClass} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="surface-button px-3 py-2 text-xs font-semibold text-critical-ink"
          disabled={revokeM.isPending}
          aria-busy={revokeM.isPending}
          onClick={() => revokeM.mutate()}
        >
          {revokeM.isPending ? "Revoking…" : "Revoke gateway"}
        </button>
      </div>
    </DialogFrame>
  );
}

/**
 * Mint or rotate. The token is held only here and in `mintM`, which `done` resets, so after
 * the dialog closes no state, query or mutation the client keeps still holds it.
 */
function TokenDialog({ gateway, onClose }: { gateway: EdgeGatewayDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const rotating = gateway.tokenLast4 !== null;
  const verb = rotating ? "Rotate token" : "Mint token";
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const mintM = useMutation({
    mutationFn: async () => mintEdgeGatewayToken(gateway.id),
    gcTime: 0,
    onSuccess: async () => {
      await invalidateEdgeGatewayReads(queryClient);
    },
  });
  const token = mintM.data?.token ?? null;
  const done = () => {
    mintM.reset();
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
    <DialogFrame label={verb}>
      {token === null ? (
        <>
          <p className="text-sm">
            {rotating
              ? `Rotate the token of ${gateway.code}? The current token stops working at once; the box needs the new one.`
              : `Mint a token for ${gateway.code}? It authenticates the box's uplink.`}
          </p>
          <ErrorLine error={mintM.error} />
          <div className="flex justify-end gap-2">
            <button type="button" className={secondaryClass} onClick={done}>
              Cancel
            </button>
            <button
              type="button"
              className={secondaryClass}
              disabled={mintM.isPending}
              aria-busy={mintM.isPending}
              onClick={() => mintM.mutate()}
            >
              {mintM.isPending ? "Minting…" : verb}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold">{TOKEN_SHOWN_ONCE}</p>
          <input
            aria-label="Gateway token"
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

/** The RTU picker: the gateway's organization's active RTUs only; the server refuses the rest anyway. */
function RtusDialog({ gateway, onClose }: { gateway: EdgeGatewayDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(gateway.rtus.map((rtu) => rtu.id)));
  const rtusQ = useQuery({ queryKey: ["admin", "rtus", "true"], queryFn: () => fetchAdminRtus("true") });
  const candidates = (rtusQ.data?.items ?? []).filter((rtu) => rtu.organizationCode === gateway.organizationCode);
  const saveM = useMutation({
    // Candidates in list order, then any selected RTU the active list does not show (an inactive one
    // already assigned), so a save never drops what the picker could not offer.
    mutationFn: async () => {
      const offered = new Set(candidates.map((rtu) => rtu.id));
      const ids = [...candidates.filter((rtu) => selected.has(rtu.id)).map((rtu) => rtu.id), ...[...selected].filter((id) => !offered.has(id))];
      return putEdgeGatewayRtus(gateway.id, ids);
    },
    onSuccess: async () => {
      await invalidateEdgeGatewayReads(queryClient);
      onClose();
    },
  });
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  return (
    <DialogFrame label="Assign RTUs">
      <p className="text-xs text-ink-muted">
        {`RTUs of ${gateway.organizationCode} that ${gateway.code} serves. An RTU needs an RTU code and an MQTT connection, and its assets must be on ingest, not the simulator.`}
      </p>
      {rtusQ.isError ? <ErrorLine error={rtusQ.error} /> : null}
      <ul className="max-h-72 space-y-1 overflow-y-auto">
        {candidates.map((rtu) => (
          <li key={rtu.id}>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={selected.has(rtu.id)} onChange={() => toggle(rtu.id)} />
              <span className="font-mono">{rtu.rtuCode ?? rtu.code}</span>
              <span className="text-ink-muted">{`${rtu.displayName} · ${rtu.locationName}`}</span>
            </label>
          </li>
        ))}
        {rtusQ.isSuccess && candidates.length === 0 ? <li className="text-xs text-ink-muted">This organization has no active RTU.</li> : null}
      </ul>
      <ErrorLine error={saveM.error} />
      <div className="flex justify-end gap-2">
        <button type="button" className={secondaryClass} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={secondaryClass}
          disabled={saveM.isPending || !rtusQ.isSuccess}
          aria-busy={saveM.isPending}
          onClick={() => saveM.mutate()}
        >
          {saveM.isPending ? "Saving…" : "Save RTUs"}
        </button>
      </div>
    </DialogFrame>
  );
}
