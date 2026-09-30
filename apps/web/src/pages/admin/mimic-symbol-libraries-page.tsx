import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import {
  MIMIC_SYMBOL_GROUP_CODES,
  type MimicGlobalLibraryStatusDto,
  type MimicOrgSymbolDto,
  type MimicOrgSymbolLibraryDto,
  type MimicSymbolGroupCode,
  type MimicSymbolLibrariesResponse,
  type MimicSymbolLibraryCode,
  type MimicSymbolStyle,
} from "@bms/shared";

import { fetchAdminOrganizations } from "../../api/admin/organizations";
import {
  createMimicOrgSymbolLibrary,
  putMimicLibrarySetting,
  updateMimicOrgSymbol,
  updateMimicOrgSymbolLibrary,
  uploadMimicOrgSymbol,
  type UpdateMimicOrgSymbolBody,
} from "../../api/mimic-symbol-libraries";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
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
 * **It fails closed at the page.** The nav entry is shown to `admin` and `organization_admin`
 * only, but a typed URL reaches this route through `AdminRoute`, which admits every master-data
 * role. For those roles the page renders one status line and mounts no query.
 *
 * Nothing here is deleted (decision 7): `active = false` retires a library or a symbol, and a
 * stored drawing keeps drawing it. Every value is a text node; an uploaded symbol is drawn from
 * its parsed shapes through `MimicGlyph`, never from the file.
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
  const [organizationId, setOrganizationId] = useState("");

  const orgsQ = useQuery({
    queryKey: ["admin", "organizations", "true"],
    queryFn: () => fetchAdminOrganizations("true"),
  });
  const organizations = orgsQ.data?.items ?? [];

  // One organization (an organization admin's own) is the only choice; select it.
  useEffect(() => {
    const only = organizations.length === 1 ? organizations[0] : undefined;
    if (organizationId === "" && only !== undefined) {
      setOrganizationId(only.id);
    }
  }, [organizations, organizationId]);

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
        <Catalog catalog={catalogQ.data} organizationId={organizationId} onChanged={refresh} />
      )}
    </div>
  );
}

type CatalogProps = {
  catalog: MimicSymbolLibrariesResponse;
  organizationId: string;
  onChanged: () => Promise<void>;
};

function Catalog({ catalog, organizationId, onChanged }: CatalogProps) {
  return (
    <>
      <GlobalLibraries libraries={catalog.global} organizationId={organizationId} onChanged={onChanged} />
      <SectionCard title="Organization libraries" bodyClassName="p-3 space-y-4">
        <CreateLibraryForm organizationId={organizationId} onChanged={onChanged} />
        {catalog.organization.length === 0 ? (
          <p className="text-xs text-ink-muted">No organization library yet.</p>
        ) : (
          catalog.organization.map((library) => <LibraryCard key={library.id} library={library} onChanged={onChanged} />)
        )}
      </SectionCard>
    </>
  );
}

/** "Global libraries": the organization's switch per library. `core` is always on (decision 4). */
function GlobalLibraries({
  libraries,
  organizationId,
  onChanged,
}: {
  libraries: readonly MimicGlobalLibraryStatusDto[];
  organizationId: string;
  onChanged: () => Promise<void>;
}) {
  const settingM = useMutation({
    mutationFn: (input: { code: MimicSymbolLibraryCode; enabled: boolean }) =>
      putMimicLibrarySetting(input.code, { organizationId, enabled: input.enabled }),
    onSuccess: onChanged,
  });

  return (
    <SectionCard title="Global libraries" bodyClassName="p-3 space-y-2">
      {settingM.error ? (
        <p role="alert" className="text-xs text-critical-ink">
          {apiErrorMessage(settingM.error)}
        </p>
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
            const pending = settingM.isPending && settingM.variables?.code === library.code;
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
                    disabled={core || pending}
                    aria-busy={pending}
                    onChange={(event) => settingM.mutate({ code: library.code, enabled: event.target.checked })}
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

const EMPTY_LIBRARY_FORM = {
  code: "",
  label: "",
  style: "stroke" as MimicSymbolStyle,
  licence: "",
  attribution: "",
  sourceUrl: "",
};

function CreateLibraryForm({ organizationId, onChanged }: { organizationId: string; onChanged: () => Promise<void> }) {
  const [form, setForm] = useState(EMPTY_LIBRARY_FORM);
  const createM = useMutation({
    mutationFn: () =>
      createMimicOrgSymbolLibrary({
        organizationId,
        code: form.code.trim(),
        label: form.label.trim(),
        style: form.style,
        licence: form.licence.trim(),
        attribution: form.attribution,
        sourceUrl: form.sourceUrl.trim() === "" ? null : form.sourceUrl.trim(),
      }),
    onSuccess: async () => {
      setForm(EMPTY_LIBRARY_FORM);
      await onChanged();
    },
  });

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    createM.mutate();
  }

  return (
    <form aria-label="New organization library" onSubmit={onSubmit} className="surface-raised space-y-2 p-3">
      <h3 className="text-sm font-semibold text-ink">New library</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className={LABEL}>
          Code
          <input
            aria-label="Code"
            required
            maxLength={27}
            value={form.code}
            onChange={(event) => setForm({ ...form, code: event.target.value })}
            className={FIELD}
          />
        </label>
        <label className={LABEL}>
          Label
          <input
            aria-label="Label"
            required
            maxLength={64}
            value={form.label}
            onChange={(event) => setForm({ ...form, label: event.target.value })}
            className={FIELD}
          />
        </label>
        <label className={LABEL}>
          Style
          <select
            aria-label="Style"
            value={form.style}
            onChange={(event) => setForm({ ...form, style: event.target.value as MimicSymbolStyle })}
            className={FIELD}
          >
            <option value="stroke">stroke — outlines</option>
            <option value="fill">fill — filled shapes</option>
          </select>
        </label>
        <label className={LABEL}>
          Licence
          <input
            aria-label="Licence"
            required
            maxLength={64}
            value={form.licence}
            onChange={(event) => setForm({ ...form, licence: event.target.value })}
            className={FIELD}
          />
        </label>
        <label className={`${LABEL} sm:col-span-2`}>
          Source URL
          <input
            type="url"
            aria-label="Source URL"
            maxLength={255}
            value={form.sourceUrl}
            onChange={(event) => setForm({ ...form, sourceUrl: event.target.value })}
            className={FIELD}
          />
        </label>
        <label className={`${LABEL} sm:col-span-3`}>
          Attribution
          <textarea
            aria-label="Attribution"
            maxLength={2000}
            rows={2}
            value={form.attribution}
            onChange={(event) => setForm({ ...form, attribution: event.target.value })}
            className={FIELD}
          />
        </label>
      </div>
      <p className="text-xs text-ink-muted">
        The code is lower-case letters and digits, starting with a letter — like plant. A layout names the library
        org.&lt;code&gt;, and the code cannot change after it is saved.
      </p>
      {createM.error ? (
        <p role="alert" className="text-xs text-critical-ink">
          {apiErrorMessage(createM.error)}
        </p>
      ) : null}
      <button type="submit" disabled={createM.isPending} aria-busy={createM.isPending} className={PRIMARY}>
        {createM.isPending ? "Creating…" : "Create library"}
      </button>
    </form>
  );
}

/** One organization library: its status, Retire/Reactivate, the upload form and its symbols. */
function LibraryCard({ library, onChanged }: { library: MimicOrgSymbolLibraryDto; onChanged: () => Promise<void> }) {
  const headingId = `mimic-org-library-${library.id}`;
  const activeM = useMutation({
    mutationFn: () => updateMimicOrgSymbolLibrary(library.id, { active: !library.active }),
    onSuccess: onChanged,
  });

  return (
    <section aria-labelledby={headingId} className="surface-raised space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <h3 id={headingId} className="text-sm font-semibold text-ink">
          {library.label}
        </h3>
        <span className="font-mono text-xs text-ink-muted">{library.key}</span>
        <StatusPill label={library.active ? "Active" : "Retired"} tone={library.active ? "ok" : "offline"} />
        <span className="text-xs text-ink-muted">{`${library.licence} · ${library.style} · ${library.symbolCount} symbols`}</span>
        <button
          type="button"
          disabled={activeM.isPending}
          aria-busy={activeM.isPending}
          onClick={() => activeM.mutate()}
          className={SECONDARY}
        >
          {activeM.isPending ? "Saving…" : library.active ? "Retire" : "Reactivate"}
        </button>
      </div>
      {activeM.error ? (
        <p role="alert" className="text-xs text-critical-ink">
          {apiErrorMessage(activeM.error)}
        </p>
      ) : null}
      <UploadSymbolForm library={library} onChanged={onChanged} />
      <OrgSymbolsTable library={library} onChanged={onChanged} />
    </section>
  );
}

/**
 * One SVG per symbol (decision 6): the API parses it into geometry and refuses anything else, and
 * its 400 names the element it refused. Name, label and group are optional — the API takes them
 * from the file name and files the symbol under General.
 */
function UploadSymbolForm({ library, onChanged }: { library: MimicOrgSymbolLibraryDto; onChanged: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [group, setGroup] = useState<MimicSymbolGroupCode | "">("");
  // Bumped after a success: a file input cannot be cleared through its value.
  const [inputKey, setInputKey] = useState(0);

  const uploadM = useMutation({
    mutationFn: (chosen: File) =>
      uploadMimicOrgSymbol(library.id, {
        file: chosen,
        name: name.trim(),
        label: label.trim(),
        group: group === "" ? undefined : group,
      }),
    onSuccess: async () => {
      setFile(null);
      setName("");
      setLabel("");
      setGroup("");
      setInputKey((n) => n + 1);
      await onChanged();
    },
  });

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    if (file !== null) uploadM.mutate(file);
  }

  return (
    <form aria-label={`Upload a symbol to ${library.label}`} onSubmit={onSubmit} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-4">
        <label className={LABEL}>
          SVG file
          <input
            key={inputKey}
            type="file"
            accept="image/svg+xml"
            aria-label="Symbol file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-xs text-ink"
          />
        </label>
        <label className={LABEL}>
          Name
          <input aria-label="Symbol name" value={name} onChange={(event) => setName(event.target.value)} className={FIELD} />
        </label>
        <label className={LABEL}>
          Label
          <input aria-label="Symbol label" value={label} onChange={(event) => setLabel(event.target.value)} className={FIELD} />
        </label>
        <label className={LABEL}>
          Group
          <select
            aria-label="Symbol group"
            value={group}
            onChange={(event) => setGroup(event.target.value as MimicSymbolGroupCode | "")}
            className={FIELD}
          >
            <option value="">General (default)</option>
            {MIMIC_SYMBOL_GROUP_CODES.map((code) => (
              <option key={code} value={code}>
                {groupLabel(code)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {uploadM.error ? (
        <p role="alert" className="text-xs text-critical-ink">
          {apiErrorMessage(uploadM.error)}
        </p>
      ) : null}
      <button type="submit" disabled={uploadM.isPending || file === null} aria-busy={uploadM.isPending} className={PRIMARY}>
        {uploadM.isPending ? "Uploading…" : "Upload"}
      </button>
    </form>
  );
}

/** The library's symbols, retired ones included: a preview, the key, the label, the group and the switch. */
function OrgSymbolsTable({ library, onChanged }: { library: MimicOrgSymbolLibraryDto; onChanged: () => Promise<void> }) {
  const symbolM = useMutation({
    mutationFn: (input: { symbol: MimicOrgSymbolDto; patch: UpdateMimicOrgSymbolBody }) =>
      updateMimicOrgSymbol(library.id, input.symbol.id, input.patch),
    onSuccess: onChanged,
  });

  if (library.symbols.length === 0) {
    return <p className="text-xs text-ink-muted">No symbol uploaded yet.</p>;
  }

  return (
    <>
      {symbolM.error ? (
        <p role="alert" className="text-xs text-critical-ink">
          {apiErrorMessage(symbolM.error)}
        </p>
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
          {library.symbols.map((symbol) => {
            const pending = symbolM.isPending && symbolM.variables?.symbol.id === symbol.id;
            return (
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
                    disabled={pending}
                    aria-busy={pending}
                    onChange={(event) =>
                      symbolM.mutate({ symbol, patch: { group: event.target.value as MimicSymbolGroupCode } })
                    }
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
                    disabled={pending}
                    aria-busy={pending}
                    onChange={(event) => symbolM.mutate({ symbol, patch: { active: event.target.checked } })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
