import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { TariffLineDto, TariffVersionDto } from "@bms/shared/contracts";

import { fetchAdminOrganizations } from "../../api/admin/organizations";
import {
  fetchTariffLineVersions,
  fetchTariffLines,
  tariffLineVersionsQueryKey,
  tariffLinesQueryKey,
} from "../../api/tariffs";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { TariffVerifyBadge } from "../../components/energy/tariff-verify-badge";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { TariffVersionDeleteDialog } from "../../components/tariffs/tariff-version-delete-dialog";
import { TariffVersionForm, type TariffVersionFormMode } from "../../components/tariffs/tariff-version-form";
import { canManageOrgTariffs, isGlobalAdmin } from "../../lib/admin-access";
import { apiErrorMessage } from "../../lib/api-error-message";
import { currentMonthInput, energyUnitLabel, fixedBasisLabel, monthLabel } from "../../lib/tariff-labels";
import type { AuthUser } from "../../stores/auth-store";

const actionClass = "text-xs font-semibold text-accent-strong";
const primaryClass = "surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent";
const filterClass = "ml-2 surface-field px-3 py-1.5 text-xs font-normal";

/** The version in force this month (the newest one dated on or before it), else the oldest. */
function currentVersion(versions: readonly TariffVersionDto[]): TariffVersionDto | null {
  const firstDay = `${currentMonthInput()}-01`;
  const inForce = versions.filter((v) => v.effectiveFrom <= firstDay);
  return inForce[inForce.length - 1] ?? versions[0] ?? null;
}

const sourceLabel = (source: TariffLineDto["source"]): string => (source === "catalog" ? "Catalog" : "Organization");

/**
 * `F4.365` U9 (ADR 0134 decision 8, Amendment 1) — Admin → Tariffs: the slab tariff catalog with
 * this organization's own revisions and custom lines, by state, segment and search. `?key=` opens
 * one line with every version (catalog and the organization's), each with its slabs.
 *
 * **Write controls are absent, not disabled, unless `canManageOrgTariffs`** (the API's
 * `isOrganizationLevelAdmin`): New revision, New custom tariff, and a version's Edit and Delete.
 * A version already in force is read-only (Amendment 1): only an organization version the API
 * marks `editable` carries Edit and Delete; it is superseded by a newer revision instead.
 * A line or version whose data status is not `official` carries the Verify badge (plan Q8).
 */
export function TariffsAdminPage({ user }: { user: AuthUser }) {
  const queryClient = useQueryClient();
  const canManage = canManageOrgTariffs(user.role);
  const [searchParams, setSearchParams] = useSearchParams();
  const openKey = searchParams.get("key");
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [state, setState] = useState("");
  const [segment, setSegment] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<TariffVersionFormMode | null>(null);
  const [deleting, setDeleting] = useState<TariffVersionDto | null>(null);

  const orgsQ = useQuery({
    queryKey: ["admin", "organizations", "true"],
    queryFn: () => fetchAdminOrganizations("true"),
  });
  const orgs = orgsQ.data?.items ?? [];
  const orgLocked = !isGlobalAdmin(user.role) && orgs.length <= 1;
  const organizationId = selectedOrgId || orgs[0]?.id || "";

  const linesQ = useQuery({
    queryKey: tariffLinesQueryKey(organizationId),
    queryFn: () => fetchTariffLines({ organizationId }),
    enabled: organizationId !== "",
  });
  const lines = linesQ.data?.items ?? [];

  async function reread(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ["tariffs"] });
  }

  function openLine(key: string | null): void {
    setSearchParams(key === null ? {} : { key });
  }

  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Tariffs"
        subtitle="Utility slab tariffs by state and category, with this organization's own revisions and custom tariffs"
        actions={
          canManage ? (
            <button type="button" className={primaryClass} disabled={organizationId === ""} onClick={() => setForm({ kind: "custom" })}>
              New custom tariff
            </button>
          ) : null
        }
      />

      {!orgLocked ? (
        <label className="text-xs font-semibold text-ink-muted">
          Organization
          <select className={filterClass} value={organizationId} onChange={(event) => setSelectedOrgId(event.target.value)}>
            {orgs.map((org) => (
              <option key={org.id} value={org.id}>
                {org.code} · {org.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {openKey === null ? (
        <LineList
          lines={lines}
          loading={linesQ.isLoading}
          error={linesQ.isError ? apiErrorMessage(linesQ.error) : null}
          state={state}
          segment={segment}
          search={search}
          onState={setState}
          onSegment={setSegment}
          onSearch={setSearch}
          onOpen={openLine}
        />
      ) : (
        <LineDetail
          lineKey={openKey}
          organizationId={organizationId}
          canManage={canManage}
          onBack={() => openLine(null)}
          onRevise={(seed) => setForm({ kind: "revision", lineKey: openKey, seed })}
          onEdit={(version) => setForm({ kind: "edit", version })}
          onDelete={setDeleting}
        />
      )}

      {form && canManage ? (
        <TariffVersionForm
          mode={form}
          organizationId={organizationId}
          onClose={() => setForm(null)}
          onSaved={async (saved) => {
            setForm(null);
            await reread();
            openLine(saved.key);
          }}
        />
      ) : null}

      {deleting && canManage ? (
        <TariffVersionDeleteDialog
          version={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            setDeleting(null);
            await reread();
          }}
        />
      ) : null}
    </MasterDataLayout>
  );
}

type LineListProps = {
  lines: readonly TariffLineDto[];
  loading: boolean;
  error: string | null;
  state: string;
  segment: string;
  search: string;
  onState: (value: string) => void;
  onSegment: (value: string) => void;
  onSearch: (value: string) => void;
  onOpen: (key: string) => void;
};

/** The lines, filtered here: the one read carries every line, so the state and segment lists are complete. */
function LineList({ lines, loading, error, state, segment, search, onState, onSegment, onSearch, onOpen }: LineListProps) {
  const states = [...new Set(lines.map((line) => line.state))].sort((a, b) => a.localeCompare(b));
  const segments = [...new Set(lines.map((line) => line.segment).filter((s) => s !== ""))].sort((a, b) => a.localeCompare(b));
  const needle = search.trim().toLowerCase();
  const shown = lines.filter(
    (line) =>
      (state === "" || line.state === state) &&
      (segment === "" || line.segment === segment) &&
      (needle === "" ||
        line.key.toLowerCase().includes(needle) ||
        line.name.toLowerCase().includes(needle) ||
        line.code.toLowerCase().includes(needle)),
  );

  return (
    <SectionCard title="Tariff lines" bodyClassName="p-3 space-y-3">
      <div className="flex flex-wrap gap-3">
        <label className="text-xs font-semibold text-ink-muted">
          State
          <select className={filterClass} value={state} onChange={(e) => onState(e.target.value)}>
            <option value="">All states</option>
            {states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-ink-muted">
          Segment
          <select className={filterClass} value={segment} onChange={(e) => onSegment(e.target.value)}>
            <option value="">All segments</option>
            {segments.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-ink-muted">
          Search
          <input
            type="search"
            className={filterClass}
            value={search}
            placeholder="Name, code or key"
            onChange={(e) => onSearch(e.target.value)}
          />
        </label>
      </div>

      {loading ? <p className="text-sm text-ink-muted">Loading tariffs…</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-critical-ink">
          {error}
        </p>
      ) : null}
      {!loading && error === null && shown.length === 0 ? <p className="text-sm text-ink-muted">No tariff line matches.</p> : null}

      <table className="min-w-full text-sm" aria-label="Tariff lines">
        <thead>
          <tr className="border-b text-left text-xs uppercase text-ink-muted">
            <th className="px-2 py-2">State</th>
            <th className="px-2 py-2">Category</th>
            <th className="px-2 py-2">Segment</th>
            <th className="px-2 py-2">Billed in</th>
            <th className="px-2 py-2">Fixed charge</th>
            <th className="px-2 py-2">Source</th>
            <th className="px-2 py-2">From</th>
            <th className="px-2 py-2">Slabs</th>
            <th className="px-2 py-2">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((line) => (
            <tr key={line.key} className="border-b border-well-deep">
              <td className="px-2 py-2">{line.state}</td>
              <td className="px-2 py-2">
                <span className="flex flex-wrap items-center gap-2">
                  {line.name}
                  {line.dataStatus !== "official" ? <TariffVerifyBadge /> : null}
                </span>
                <span className="block text-xs text-ink-muted">
                  {line.code} · <code>{line.key}</code>
                </span>
              </td>
              <td className="px-2 py-2">{line.segment}</td>
              <td className="px-2 py-2">{energyUnitLabel(line.energyUnit)}</td>
              <td className="px-2 py-2">{fixedBasisLabel(line.fixedBasis)}</td>
              <td className="px-2 py-2">{sourceLabel(line.source)}</td>
              <td className="px-2 py-2">{monthLabel(line.effectiveFrom)}</td>
              <td className="px-2 py-2 font-mono">{line.slabCount}</td>
              <td className="px-2 py-2">
                <button type="button" className={actionClass} aria-label={`Open ${line.name} (${line.key})`} onClick={() => onOpen(line.key)}>
                  Open
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </SectionCard>
  );
}

type LineDetailProps = {
  lineKey: string;
  organizationId: string;
  canManage: boolean;
  onBack: () => void;
  onRevise: (seed: TariffVersionDto | null) => void;
  onEdit: (version: TariffVersionDto) => void;
  onDelete: (version: TariffVersionDto) => void;
};

/** One line: every version, oldest first, each with its slabs. */
function LineDetail({ lineKey, organizationId, canManage, onBack, onRevise, onEdit, onDelete }: LineDetailProps) {
  const versionsQ = useQuery({
    queryKey: tariffLineVersionsQueryKey(lineKey, organizationId),
    queryFn: () => fetchTariffLineVersions(lineKey, organizationId),
    // Wait for the organization: read without one, the line would show the catalog's versions
    // alone and then re-read with the organization's own.
    enabled: organizationId !== "",
  });
  const versions = versionsQ.data?.versions ?? [];
  const current = currentVersion(versions);
  const newest = versions[versions.length - 1];

  return (
    <SectionCard
      title={newest ? `${newest.state} · ${newest.code} · ${newest.name}` : lineKey}
      subtitle={<code>{lineKey}</code>}
      bodyClassName="p-3 space-y-4"
      actions={
        <div className="flex gap-3">
          <button type="button" className={actionClass} onClick={onBack}>
            Back to tariffs
          </button>
          {canManage && versions.length > 0 ? (
            <button type="button" className={primaryClass} onClick={() => onRevise(current)}>
              New revision
            </button>
          ) : null}
        </div>
      }
    >
      {versionsQ.isLoading ? <p className="text-sm text-ink-muted">Loading versions…</p> : null}
      {versionsQ.isError ? (
        <p role="alert" className="text-sm text-critical-ink">
          {apiErrorMessage(versionsQ.error)}
        </p>
      ) : null}

      {versions.map((version) => {
        const label = `${sourceLabel(version.source)} version from ${monthLabel(version.effectiveFrom)}`;
        return (
          <section key={version.id} aria-label={label} className="rounded border border-well-deep p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                {label}
                {version.id === current?.id ? <StatusPill label="In force" tone="ok" /> : null}
                {version.dataStatus !== "official" ? <TariffVerifyBadge /> : null}
              </h3>
              {canManage && version.editable ? (
                <div className="flex gap-2">
                  <button type="button" className={actionClass} aria-label={`Edit ${label}`} onClick={() => onEdit(version)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text-xs font-semibold text-critical-ink"
                    aria-label={`Delete ${label}`}
                    onClick={() => onDelete(version)}
                  >
                    Delete
                  </button>
                </div>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              {`Billed in ${energyUnitLabel(version.energyUnit)} · fixed charge ${fixedBasisLabel(version.fixedBasis)} · ${version.dataStatus}`}
              {version.tariffOrder ? ` · ${version.tariffOrder}` : null}
            </p>
            {version.sourceUrl ? (
              <p className="text-xs">
                <a className={actionClass} href={version.sourceUrl} target="_blank" rel="noopener noreferrer">
                  Source
                </a>
              </p>
            ) : null}
            {version.reason ? <p className="text-xs text-ink-muted">{`Reason: ${version.reason}`}</p> : null}
            <table className="mt-2 min-w-full text-sm" aria-label={`Slabs of the ${label}`}>
              <thead>
                <tr className="border-b text-left text-xs uppercase text-ink-muted">
                  <th className="px-2 py-1">Slab</th>
                  <th className="px-2 py-1">From</th>
                  <th className="px-2 py-1">To</th>
                  <th className="px-2 py-1">Energy rate</th>
                  <th className="px-2 py-1">Fixed rate</th>
                  <th className="px-2 py-1">Wheeling rate</th>
                  <th className="px-2 py-1">Notes</th>
                </tr>
              </thead>
              <tbody>
                {version.slabs.map((slab) => (
                  <tr key={slab.slabNo} className="border-b border-well-deep">
                    <td className="px-2 py-1 font-mono">{slab.slabNo}</td>
                    <td className="px-2 py-1 font-mono">{slab.fromUnits}</td>
                    <td className="px-2 py-1 font-mono">{slab.toUnits ?? "and above"}</td>
                    <td className="px-2 py-1 font-mono">{slab.energyRate}</td>
                    <td className="px-2 py-1 font-mono">{slab.fixedRate}</td>
                    <td className="px-2 py-1 font-mono">{slab.wheelingRate}</td>
                    <td className="px-2 py-1 text-xs">{slab.notes ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </SectionCard>
  );
}
