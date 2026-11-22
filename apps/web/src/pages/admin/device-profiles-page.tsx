import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { deviceProfileCodeSchema } from "@bms/shared";
import type { DeviceProfileDto, DeviceProfileList } from "@bms/shared/contracts";

import {
  deviceProfilesKey,
  useCopyDeviceProfile,
  useDeviceProfiles,
  useImportStockDeviceProfile,
  useStockDeviceProfiles,
} from "../../api/admin/device-profiles";
import { fetchAdminOrganizations } from "../../api/admin/organizations";
import { DeviceProfileEditor } from "../../components/admin/device-profile-editor";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { canManageDeviceProfiles } from "../../lib/admin-access";
import { apiErrorMessage } from "../../lib/api-error-message";
import type { AuthUser } from "../../stores/auth-store";

type DeviceProfilesAdminPageProps = { user: AuthUser };

/** The organizations list the Locations page reads; one cache entry for both screens. */
const ORGANIZATIONS_KEY = ["admin", "organizations", "all"] as const;

const CODE_RULE = "A code is letters, digits, _ and -, at most 64 characters.";

/** What the editor is open on: nothing, a new profile, or the newest row of one code. */
type Editing = { kind: "none" } | { kind: "new" } | { kind: "edit"; base: DeviceProfileDto };

/**
 * One entry per code: its newest row (the only one the editor may open, since
 * a save from an older base is a 409) and how many versions it has. Computed
 * from `version`, not from the list's order.
 */
function newestPerCode(list: DeviceProfileList): { newest: DeviceProfileDto; versions: number }[] {
  const byCode = new Map<string, { newest: DeviceProfileDto; versions: number }>();
  for (const row of list) {
    const held = byCode.get(row.code);
    if (!held) {
      byCode.set(row.code, { newest: row, versions: 1 });
    } else {
      held.versions += 1;
      if (row.version > held.newest.version) held.newest = row;
    }
  }
  return [...byCode.values()].sort((a, b) => a.newest.code.localeCompare(b.newest.code));
}

/**
 * `F1.2` (ADR 0141 decisions 12–14, plan T6.1) — an organization's Modbus
 * device profiles: list one row per code at its newest version, create, edit
 * (every save a new version, P2), copy under a new code, and import a stock
 * profile as the organization's own copy.
 *
 * **It fails closed at the page.** The tab is hidden from every role but
 * `admin` and `organization_admin` (`canManageDeviceProfiles`, the API's write
 * gate), but a typed URL still reaches this route through `AdminRoute`, which
 * admits every master-data role. For the others the page renders one status
 * line and mounts no query.
 */
export function DeviceProfilesAdminPage({ user }: DeviceProfilesAdminPageProps) {
  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Device Profiles"
        subtitle="Modbus register maps, per organization; every save is a new version"
      />
      {canManageDeviceProfiles(user.role) ? (
        <DeviceProfilesWorkspace />
      ) : (
        <p role="status" className="text-sm text-ink-muted">
          Device profiles are managed by an organization administrator or a global administrator.
        </p>
      )}
    </MasterDataLayout>
  );
}

function DeviceProfilesWorkspace() {
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState("");
  const [editing, setEditing] = useState<Editing>({ kind: "none" });
  const [copying, setCopying] = useState<DeviceProfileDto | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const orgsQ = useQuery({ queryKey: ORGANIZATIONS_KEY, queryFn: () => fetchAdminOrganizations("all") });
  const organizations = orgsQ.data?.items ?? [];
  // The list is a 400 without an organization: a global admin's first organization is the default.
  const organizationId = chosen || organizations[0]?.id || "";

  const listQ = useDeviceProfiles(organizationId);
  const entries = newestPerCode(listQ.data ?? []);

  function closeEditor(): void {
    setEditing({ kind: "none" });
  }

  function reload(): void {
    closeEditor();
    void queryClient.invalidateQueries({ queryKey: deviceProfilesKey(organizationId) });
  }

  const action = "text-xs font-semibold text-accent-strong";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="device-profiles-organization" className="block text-xs font-semibold text-ink-muted">
            Organization
          </label>
          <select
            id="device-profiles-organization"
            className="mt-1 surface-field px-3 py-2 text-sm"
            value={organizationId}
            onChange={(event) => {
              setChosen(event.target.value);
              setEditing({ kind: "none" });
              setCopying(null);
            }}
          >
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.code} — {organization.name}
              </option>
            ))}
          </select>
        </div>
        <span className="flex-1" />
        <button
          type="button"
          className="surface-button px-3 py-2 text-xs font-semibold"
          aria-expanded={importOpen}
          onClick={() => setImportOpen((open) => !open)}
        >
          Import stock profile
        </button>
        <button
          type="button"
          className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent disabled:opacity-60"
          disabled={organizationId === ""}
          onClick={() => setEditing({ kind: "new" })}
        >
          New profile
        </button>
      </div>

      {orgsQ.isError ? (
        <p role="alert" className="text-sm text-critical-ink">
          {apiErrorMessage(orgsQ.error)}
        </p>
      ) : null}

      {importOpen && organizationId !== "" ? (
        // Keyed by organization: an import's message or a pending confirmation belongs to one.
        <StockPanel
          key={organizationId}
          organizationId={organizationId}
          held={new Map(entries.map(({ newest }) => [newest.code, newest.version]))}
        />
      ) : null}

      {editing.kind !== "none" ? (
        <DeviceProfileEditor
          // A different row, or a new profile, starts the draft again.
          key={editing.kind === "edit" ? editing.base.id : "new"}
          organizationId={organizationId}
          base={editing.kind === "edit" ? editing.base : null}
          onClose={closeEditor}
          onReload={reload}
        />
      ) : null}

      {copying ? (
        <CopyForm key={copying.id} source={copying} onClose={() => setCopying(null)} />
      ) : null}

      <SectionCard title="Profiles" subtitle="One row per code, at its newest version">
        {listQ.isError ? (
          <p role="alert" className="text-sm text-critical-ink">
            {apiErrorMessage(listQ.error)}
          </p>
        ) : null}
        {listQ.isPending && organizationId !== "" ? (
          <p role="status" className="text-xs text-ink-muted">
            Loading device profiles…
          </p>
        ) : null}
        {listQ.isSuccess && entries.length === 0 ? (
          <p className="text-sm text-ink-muted">No device profiles yet. Create one, or import a stock profile.</p>
        ) : null}
        {entries.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-ink-muted">
                  <th className="px-2 py-2">Code</th>
                  <th className="px-2 py-2">Version</th>
                  <th className="px-2 py-2">Vendor</th>
                  <th className="px-2 py-2">Model</th>
                  <th className="px-2 py-2">Registers</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(({ newest, versions }) => (
                  <tr key={newest.code} data-profile-code={newest.code} className="border-b border-well-deep">
                    <td className="px-2 py-2 font-mono">{newest.code}</td>
                    <td className="px-2 py-2 font-mono" title={`${versions} version${versions === 1 ? "" : "s"}`}>
                      v{newest.version}
                    </td>
                    <td className="px-2 py-2">{newest.vendor}</td>
                    <td className="px-2 py-2">{newest.model}</td>
                    <td className="px-2 py-2 font-mono">{String(newest.registers.length)}</td>
                    <td className="px-2 py-2">
                      {newest.verified ? (
                        <StatusPill label="Verified" tone="ok" />
                      ) : (
                        <StatusPill label="Unverified" tone="warning" />
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          aria-label={`Edit ${newest.code}`}
                          className={action}
                          onClick={() => setEditing({ kind: "edit", base: newest })}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          aria-label={`Copy ${newest.code}`}
                          className={action}
                          onClick={() => setCopying(newest)}
                        >
                          Copy
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}

/** Copy asks for the new code, checked with the shared code schema before it is sent. */
function CopyForm({ source, onClose }: { source: DeviceProfileDto; onClose: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const copyM = useCopyDeviceProfile();
  const id = "device-profile-copy-code";

  function submit(): void {
    const parsed = deviceProfileCodeSchema.safeParse(code.trim());
    if (!parsed.success) {
      setError(CODE_RULE);
      return;
    }
    setError(null);
    copyM.mutate(
      { id: source.id, code: parsed.data },
      { onSuccess: onClose, onError: (cause: unknown) => setError(apiErrorMessage(cause)) },
    );
  }

  return (
    <SectionCard title={`Copy ${source.code}`} subtitle={`Copies v${source.version} under a new code, as version 1, unverified.`}>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={id} className="block text-xs font-semibold text-ink-muted">
            New code for the copy of {source.code}
          </label>
          <input
            id={id}
            className="mt-1 surface-field px-3 py-2 font-mono text-sm"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent disabled:opacity-60"
          disabled={copyM.isPending}
          aria-busy={copyM.isPending}
          onClick={submit}
        >
          {copyM.isPending ? "Copying…" : "Create copy"}
        </button>
        <button type="button" className="surface-button px-3 py-2 text-xs font-semibold" onClick={onClose}>
          Cancel
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-critical-ink">
          {error}
        </p>
      ) : null}
    </SectionCard>
  );
}

type StockPanelProps = {
  organizationId: string;
  /** The organization's codes, each at its newest version. */
  held: ReadonlyMap<string, number>;
};

/**
 * The stock profiles the repository ships; Import copies one into the organization's own rows.
 * A code the organization already holds imports as its next version (the API's `max + 1`), so
 * that row says "held at vN" and its Import asks before it posts.
 */
function StockPanel({ organizationId, held }: StockPanelProps) {
  const stockQ = useStockDeviceProfiles(true);
  const importM = useImportStockDeviceProfile();
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  function runImport(code: string): void {
    setError(null);
    setImported(null);
    setConfirming(null);
    importM.mutate(
      { code, organizationId },
      {
        onSuccess: (row) => setImported(`Imported ${row.code} as v${row.version}.`),
        onError: (cause: unknown) => setError(apiErrorMessage(cause)),
      },
    );
  }

  const heldAt = confirming === null ? undefined : held.get(confirming);
  const stock = stockQ.data ?? [];
  const action = "text-xs font-semibold text-accent-strong disabled:opacity-60";

  return (
    <section aria-label="Stock profiles">
      <SectionCard title="Stock profiles" subtitle="Shipped with the product; an import is the organization's own copy">
        {stockQ.isError ? (
          <p role="alert" className="text-sm text-critical-ink">
            {apiErrorMessage(stockQ.error)}
          </p>
        ) : null}
        {stockQ.isSuccess && stock.length === 0 ? (
          <p className="text-sm text-ink-muted">No stock profiles ship with this release.</p>
        ) : null}
        {stock.length > 0 ? (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-ink-muted">
                <th className="px-2 py-2">Code</th>
                <th className="px-2 py-2">Version</th>
                <th className="px-2 py-2">Vendor</th>
                <th className="px-2 py-2">Model</th>
                <th className="px-2 py-2">Registers</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {stock.map((entry) => (
                <tr key={entry.code} className="border-b border-well-deep">
                  <td className="px-2 py-2 font-mono">
                    {entry.code}
                    {held.has(entry.code) ? (
                      <span className="ml-2 text-xs text-ink-muted">held at v{held.get(entry.code)}</span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 font-mono">v{entry.version}</td>
                  <td className="px-2 py-2">{entry.vendor}</td>
                  <td className="px-2 py-2">{entry.model}</td>
                  <td className="px-2 py-2 font-mono">{String(entry.registers.length)}</td>
                  <td className="px-2 py-2">
                    {entry.verified ? (
                      <StatusPill label="Verified" tone="ok" />
                    ) : (
                      <StatusPill label="Unverified" tone="warning" />
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      aria-label={
                        importM.isPending && importM.variables?.code === entry.code
                          ? `Importing ${entry.code}`
                          : `Import ${entry.code}`
                      }
                      className={action}
                      disabled={importM.isPending}
                      aria-busy={importM.isPending && importM.variables?.code === entry.code}
                      onClick={() => (held.has(entry.code) ? setConfirming(entry.code) : runImport(entry.code))}
                    >
                      {importM.isPending && importM.variables?.code === entry.code ? "Importing…" : "Import"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {confirming !== null && heldAt !== undefined ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span>
              This organization holds {confirming} at v{heldAt}. Importing saves the stock file as v{heldAt + 1}.
            </span>
            <button
              type="button"
              className="surface-button px-3 py-1 text-xs font-semibold"
              disabled={importM.isPending}
              aria-busy={importM.isPending}
              onClick={() => runImport(confirming)}
            >
              {importM.isPending ? "Importing…" : `Import as v${heldAt + 1}`}
            </button>
            <button type="button" className="text-xs font-semibold text-ink-muted" onClick={() => setConfirming(null)}>
              Cancel
            </button>
          </div>
        ) : null}
        {imported ? (
          <p role="status" className="mt-2 text-sm text-ok-ink">
            {imported}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-2 text-sm text-critical-ink">
            {error}
          </p>
        ) : null}
      </SectionCard>
    </section>
  );
}
