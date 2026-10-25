import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AssetRoleDto } from "@bms/shared";

import { fetchAssetRoleCatalog } from "../../api/admin/asset-roles";
import { AssetRoleEditWizard, AssetRoleToggleWizard, AssetRoleWizard } from "../../components/admin/asset-role-wizard";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { isGlobalAdmin } from "../../lib/admin-access";
import type { AuthUser } from "../../stores/auth-store";

/** This page's read (`GET /admin/vocabularies/asset-roles`). */
const CATALOG_KEY = ["admin", "asset-roles-catalog"] as const;
/** The fleet-wide vocabularies every picker reads (`GET /vocabularies`). */
const VOCABULARIES_KEY = ["vocabularies"] as const;

type Open = { kind: "create" } | { kind: "edit" | "toggle"; role: AssetRoleDto } | null;

/**
 * `F4.282` (ADR 0099 Amendment 8 Q17) — the global-admin screen for the unit-role
 * vocabulary, `bms.asset_roles` (ADR 0051 decision 5). Add, Edit and Deactivate /
 * Reactivate are the `assetRole.*` catalog wizards, so every write here is the route
 * the copilot proposes; a wizard used alone sends no `X-Copilot-Change` header.
 *
 * **It fails closed at the page**, the Location Types rule: the tab is the global
 * `admin`'s alone, but a typed URL reaches this route through `AdminRoute`; for any
 * other role the page renders one status line and mounts no query.
 */
export function UnitRolesAdminPage({ user }: { user: AuthUser }) {
  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Unit Roles"
        subtitle="Fleet-wide vocabulary of unit roles that asset groups and mimic layouts bind by"
      />
      {isGlobalAdmin(user.role) ? (
        <UnitRolesCatalog />
      ) : (
        <p role="status" className="text-sm text-ink-muted">
          Unit roles are managed by a global administrator.
        </p>
      )}
    </MasterDataLayout>
  );
}

function UnitRolesCatalog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<Open>(null);
  const listQ = useQuery({ queryKey: CATALOG_KEY, queryFn: fetchAssetRoleCatalog });

  async function done(): Promise<void> {
    setOpen(null);
    await queryClient.invalidateQueries({ queryKey: CATALOG_KEY });
    await queryClient.invalidateQueries({ queryKey: VOCABULARIES_KEY });
  }
  const cancel = () => setOpen(null);

  return (
    <>
      <SectionCard title="Unit role catalog" bodyClassName="p-3 space-y-3">
        <div className="flex justify-end">
          <button
            type="button"
            className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent"
            onClick={() => setOpen({ kind: "create" })}
          >
            Add a unit role
          </button>
        </div>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-ink-muted">
              <th className="px-2 py-2">Code</th>
              <th className="px-2 py-2">Label</th>
              <th className="px-2 py-2">Sort order</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(listQ.data?.items ?? []).map((role) => (
              <tr key={role.code} className="border-b border-well-deep">
                <td className="px-2 py-2 font-mono">{role.code}</td>
                <td className="px-2 py-2">{role.label}</td>
                <td className="px-2 py-2">{role.sortOrder}</td>
                <td className="px-2 py-2">
                  <StatusPill label={role.active ? "Active" : "Inactive"} tone={role.active ? "ok" : "offline"} />
                </td>
                <td className="px-2 py-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs font-semibold text-accent-strong"
                      onClick={() => setOpen({ kind: "edit", role })}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-xs font-semibold text-ink-muted"
                      onClick={() => setOpen({ kind: "toggle", role })}
                    >
                      {role.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>
      {open?.kind === "create" ? <AssetRoleWizard onCancel={cancel} onDone={done} /> : null}
      {open?.kind === "edit" ? (
        <AssetRoleEditWizard key={`edit-${open.role.code}`} role={open.role} onCancel={cancel} onDone={done} />
      ) : null}
      {open?.kind === "toggle" ? (
        <AssetRoleToggleWizard key={`toggle-${open.role.code}`} role={open.role} onCancel={cancel} onDone={done} />
      ) : null}
    </>
  );
}
