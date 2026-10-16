import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  MIMIC_SYMBOL_GROUP_CODES,
  type MimicGlobalLibraryStatusDto,
  type MimicOrgSymbolDto,
  type MimicOrgSymbolLibraryDto,
  type MimicSymbolGroupCode,
  type MimicSymbolLibrariesResponse,
} from "@bms/shared";

import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { LibraryCreateWizard, LibrarySettingWizard, LibraryUpdateWizard } from "../../components/admin/mimic-library-wizards";
import { SymbolUpdateWizard, SymbolUploadWizard } from "../../components/admin/mimic-symbol-wizards";
import { PageHeader } from "../../components/page-header";
import { useOrganizationChoice } from "../../hooks/use-organization-choice";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { MimicGlyph } from "../../components/widgets/mimic-glyphs";
import { mimicSymbolLibrariesQueryKey, useMimicSymbolLibraries } from "../../hooks/use-mimic-symbol-libraries";
import { canManageSymbolLibraries, isGlobalAdmin } from "../../lib/admin-access";
import { apiErrorMessage } from "../../lib/api-error-message";
import { MIMIC_SYMBOL_GROUPS } from "../../lib/mimic-symbols";
import type { AuthUser } from "../../stores/auth-store";

type MimicSymbolLibrariesPageProps = { user: AuthUser };

/** The sentence every other role reads. */
export const SYMBOL_LIBRARIES_REFUSAL =
  "Symbol libraries are managed by an administrator or an organization administrator.";

const FIELD = "mt-1 w-full surface-field px-2 py-1 text-sm";
const LABEL = "block text-xs font-semibold text-ink-muted";
const PRIMARY = "surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent disabled:opacity-50";
const SECONDARY = "surface-button px-3 py-1 text-xs disabled:opacity-50";

/** A group code's label, from the palette's table. */
function groupLabel(code: MimicSymbolGroupCode): string {
  return MIMIC_SYMBOL_GROUPS.find((group) => group.key === code)?.label ?? code;
}

/**
 * `F3.32f` slice 3 (ADR 0086 decisions 4, 6 and 7; plan D10) — the Symbol Libraries screen: the
 * organization's switch for each global library, and its own libraries — create, retire and
 * reactivate one, upload an SVG per symbol, and file or retire each symbol.
 *
 * **It fails closed at the page.** The tab is shown to `admin` and `organization_admin` only
 * (the sidebar reaches it through its Templates & Visuals area, `F3.76`), but a typed URL reaches this route through `AdminRoute`, which admits every master-data
 * role. For those roles the page renders one status line and mounts no query.
 *
 * Nothing here is deleted (decision 7): `active = false` retires a library or a symbol, and a
 * stored drawing keeps drawing it. Every value is a text node; an uploaded symbol is drawn from
 * its parsed shapes through `MimicGlyph`, never from the file.
 *
 * **Every write is a wizard** (`F3.87` PR 6b, ADR 0099 decision 6, plan D6): the built-in
 * library switch, the library create, edit, retire and reactivate, the symbol upload and the
 * symbol edit each open their catalog entry's `WizardShell`
 * (`components/admin/mimic-library-wizards.tsx`, `mimic-symbol-wizards.tsx`) — one write path per
 * route, the same one the copilot's `fill_step` pre-fills.
 */
export function MimicSymbolLibrariesPage({ user }: MimicSymbolLibrariesPageProps) {
  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Symbol Libraries"
        subtitle="Turn a global symbol library off for an organization, and upload the organization's own symbols"
      />
      {canManageSymbolLibraries(user.role) ? (
        <SymbolLibrariesAdmin globalAdmin={isGlobalAdmin(user.role)} />
      ) : (
        <p role="status" className="text-sm text-ink-muted">
          {SYMBOL_LIBRARIES_REFUSAL}
        </p>
      )}
    </MasterDataLayout>
  );
}

function SymbolLibrariesAdmin({ globalAdmin }: { globalAdmin: boolean }) {
  const queryClient = useQueryClient();
  const { organizations, organizationId, setOrganizationId } = useOrganizationChoice();

  const catalogQ = useMimicSymbolLibraries(organizationId === "" ? undefined : organizationId, {
    enabled: organizationId !== "",
  });

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: mimicSymbolLibrariesQueryKey(organizationId) });
  }

  return (
    <div className="space-y-4">
      {globalAdmin ? (
        <label className={`${LABEL} max-w-md`}>
          Organization
          <select
            aria-label="Organization"
            value={organizationId}
            onChange={(event) => setOrganizationId(event.target.value)}
            className={FIELD}
          >
            <option value="">Select an organization…</option>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {`${org.code} — ${org.name}`}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {organizationId === "" ? (
        <p className="text-sm text-ink-muted">Choose an organization to manage its symbol libraries.</p>
      ) : catalogQ.isError ? (
        <p role="alert" className="text-sm text-critical-ink">
          {apiErrorMessage(catalogQ.error)}
        </p>
      ) : catalogQ.data === undefined ? (
        <p className="text-sm text-ink-muted">Loading the symbol libraries…</p>
      ) : (
        <Catalog
          catalog={catalogQ.data}
          organizationId={organizationId}
          organizationName={organizations.find((org) => org.id === organizationId)?.name ?? ""}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

type CatalogProps = {
  catalog: MimicSymbolLibrariesResponse;
  organizationId: string;
  organizationName: string;
  onChanged: () => Promise<void>;
};

function Catalog({ catalog, organizationId, organizationName, onChanged }: CatalogProps) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <GlobalLibraries libraries={catalog.global} organizationId={organizationId} organizationName={organizationName} onChanged={onChanged} />
      <SectionCard title="Organization libraries" bodyClassName="p-3 space-y-4">
        <button type="button" onClick={() => setCreating(true)} className={PRIMARY}>
          New library
        </button>
        {creating ? (
          <LibraryCreateWizard
            organizationId={organizationId}
            organizationName={organizationName}
            onCancel={() => setCreating(false)}
            onDone={async () => {
              setCreating(false);
              await onChanged();
            }}
          />
        ) : null}
        {catalog.organization.length === 0 ? (
          <p className="text-xs text-ink-muted">No organization library yet.</p>
        ) : (
          catalog.organization.map((library) => <LibraryCard key={library.id} library={library} onChanged={onChanged} />)
        )}
      </SectionCard>
    </>
  );
}

/**
 * "Global libraries": the organization's switch per library. `core` is always on (decision 4).
 * A box shows the stored switch; changing it opens the `mimicLibrary.setting` wizard (`F3.87`
 * PR 6b, plan D6), which saves it.
 */
function GlobalLibraries({
  libraries,
  organizationId,
  organizationName,
  onChanged,
}: {
  libraries: readonly MimicGlobalLibraryStatusDto[];
  organizationId: string;
  organizationName: string;
  onChanged: () => Promise<void>;
}) {
  const [toggling, setToggling] = useState<{ library: MimicGlobalLibraryStatusDto; enabled: boolean } | null>(null);

  return (
    <SectionCard title="Global libraries" bodyClassName="p-3 space-y-2">
      {toggling !== null ? (
        <LibrarySettingWizard
          key={toggling.library.code}
          library={toggling.library}
          organizationId={organizationId}
          organizationName={organizationName}
          enabled={toggling.enabled}
          onCancel={() => setToggling(null)}
          onDone={async () => {
            setToggling(null);
            await onChanged();
          }}
        />
      ) : null}
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase text-ink-muted">
            <th className="px-2 py-2">Library</th>
            <th className="px-2 py-2">Licence</th>
            <th className="px-2 py-2">Style</th>
            <th className="px-2 py-2">Enabled</th>
          </tr>
        </thead>
        <tbody>
          {libraries.map((library) => {
            const core = library.code === "core";
            return (
              <tr key={library.code} className="border-b border-line">
                <td className="px-2 py-2 text-ink">{library.label}</td>
                <td className="px-2 py-2 text-ink-muted">{library.licence}</td>
                <td className="px-2 py-2 text-ink-muted">{library.style}</td>
                <td className="px-2 py-2">
                  <input
                    type="checkbox"
                    aria-label={`Enable ${library.label} for this organization`}
                    title={core ? "Core cannot be disabled" : undefined}
                    checked={library.enabled}
                    disabled={core}
                    onChange={(event) => setToggling({ library, enabled: event.target.checked })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </SectionCard>
  );
}

/** One organization library: its status, Edit and Retire/Reactivate, Upload a symbol, and its symbols — each write a wizard. */
function LibraryCard({ library, onChanged }: { library: MimicOrgSymbolLibraryDto; onChanged: () => Promise<void> }) {
  const headingId = `mimic-org-library-${library.id}`;
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [uploading, setUploading] = useState(false);
  const done = (close: () => void) => async () => {
    close();
    await onChanged();
  };

  return (
    <section aria-labelledby={headingId} className="surface-raised space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <h3 id={headingId} className="text-sm font-semibold text-ink">
          {library.label}
        </h3>
        <span className="font-mono text-xs text-ink-muted">{library.key}</span>
        <StatusPill label={library.active ? "Active" : "Retired"} tone={library.active ? "ok" : "offline"} />
        <span className="text-xs text-ink-muted">{`${library.licence} · ${library.style} · ${library.symbolCount} symbols`}</span>
        <button type="button" onClick={() => setEditing({})} className={SECONDARY}>
          Edit
        </button>
        <button type="button" onClick={() => setEditing({ active: !library.active })} className={SECONDARY}>
          {library.active ? "Retire" : "Reactivate"}
        </button>
        <button type="button" onClick={() => setUploading(true)} className={SECONDARY}>
          Upload a symbol
        </button>
      </div>
      {editing !== null ? (
        <LibraryUpdateWizard library={library} start={editing} onCancel={() => setEditing(null)} onDone={done(() => setEditing(null))} />
      ) : null}
      {uploading ? (
        <SymbolUploadWizard library={library} onCancel={() => setUploading(false)} onDone={done(() => setUploading(false))} />
      ) : null}
      <OrgSymbolsTable library={library} onChanged={onChanged} />
    </section>
  );
}

/**
 * The library's symbols, retired ones included: a preview, the key, the label, the group and the
 * switch. A changed group or switch opens the `mimicSymbol.update` wizard with that change.
 */
function OrgSymbolsTable({ library, onChanged }: { library: MimicOrgSymbolLibraryDto; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<{ symbol: MimicOrgSymbolDto; start: Record<string, unknown> } | null>(null);

  if (library.symbols.length === 0) {
    return <p className="text-xs text-ink-muted">No symbol uploaded yet.</p>;
  }

  return (
    <>
      {editing !== null ? (
        <SymbolUpdateWizard
          library={library}
          symbol={editing.symbol}
          start={editing.start}
          onCancel={() => setEditing(null)}
          onDone={async () => {
            setEditing(null);
            await onChanged();
          }}
        />
      ) : null}
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase text-ink-muted">
            <th className="px-2 py-2">Symbol</th>
            <th className="px-2 py-2">Key</th>
            <th className="px-2 py-2">Label</th>
            <th className="px-2 py-2">Group</th>
            <th className="px-2 py-2">Active</th>
          </tr>
        </thead>
        <tbody>
          {library.symbols.map((symbol) => (
            <tr key={symbol.id} className="border-b border-line">
              <td className="px-2 py-2">
                <svg
                  data-testid="mimic-org-symbol-preview"
                  viewBox="0 0 24 24"
                  width={24}
                  height={24}
                  className="h-6 w-6"
                  aria-hidden="true"
                >
                  <MimicGlyph kind={symbol.key} x={0} y={0} size={24} className="stroke-ink" orgSymbol={symbol} />
                </svg>
              </td>
              <td className="px-2 py-2 font-mono text-xs text-ink-muted">{symbol.key}</td>
              <td className="px-2 py-2 text-ink">{symbol.label}</td>
              <td className="px-2 py-2">
                <select
                  aria-label={`Group of ${symbol.label}`}
                  value={symbol.group}
                  onChange={(event) => setEditing({ symbol, start: { group: event.target.value as MimicSymbolGroupCode } })}
                  className="surface-field px-2 py-1 text-xs"
                >
                  {MIMIC_SYMBOL_GROUP_CODES.map((code) => (
                    <option key={code} value={code}>
                      {groupLabel(code)}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-2 py-2">
                <input
                  type="checkbox"
                  aria-label={`Active ${symbol.label}`}
                  checked={symbol.active}
                  onChange={(event) => setEditing({ symbol, start: { active: event.target.checked } })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
