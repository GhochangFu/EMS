import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { QUALITY_POLICIES } from "@bms/shared";
import type {
  AdminAssetPointDto,
  AssetPointCalcConfigDto,
  MasterDataActiveFilter,
  QualityPolicy,
} from "@bms/shared";

import {
  clearAdminAssetPointCalcOverride,
  createAdminAssetPoint,
  deactivateAdminAssetPoint,
  fetchAdminAssetCalcPoints,
  fetchAdminAssetPoints,
  reactivateAdminAssetPoint,
  setAdminAssetPointCalcOverride,
  updateAdminAssetPoint,
} from "../../api/admin/asset-points";
import { fetchAdminAssetSummary } from "../../api/admin/assets";
import { fetchAdminPointKeys } from "../../api/admin/point-keys";
import { ActiveFilterBar } from "../../components/admin/active-filter-bar";
import {
  HierarchyFilterBar,
  type HierarchySelection,
} from "../../components/admin/hierarchy-filter-bar";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { AssetPointBulkEditPanel } from "../../components/assets/asset-point-bulk-edit-panel";
import { MappingSheetPanel } from "../../components/assets/mapping-sheet-panel";
import { PointCalcOverridePanel } from "../../components/assets/point-calc-override-panel";
import { SectionCard } from "../../components/section-card";
import { apiErrorMessage } from "../../lib/api-error-message";
import {
  createBodyFrom,
  editBodyFrom,
  emptyAssetPointForm,
  formFrom,
  type AssetPointForm,
} from "../../lib/asset-point-form";
import {
  effectivePointMetadata,
  inheritedFields,
  inheritedParts,
  qualityCell,
  rangeCell,
  scaleCell,
  QUALITY_FIELDS,
  RANGE_FIELDS,
  SCALE_FIELDS,
  type EffectivePointMetadata,
  type MetadataField,
} from "../../lib/asset-point-effective";
import {
  calcRuntimePillLabel,
  draftFromConfig,
  draftToBody,
  hasAnyOverride,
  EMPTY_DRAFT,
  type OverrideDraft,
} from "../../lib/asset-point-calc-override";
import { StatusPill } from "../../components/status-pill";
import type { AuthUser } from "../../stores/auth-store";

/**
 * `F2.9` Task 16 (ADR 0055 decision 8; plan design decision 9, layer 3) — what
 * the engine last did with one derived point, beside what it is configured to
 * do. `written 12 s ago` / `skipped: dependency_cycle`.
 *
 * Nothing is rendered when the API reports no outcome. That is deliberate: the
 * registry feeding it is in-process and empty after a restart, so `null` means
 * "this API process has not evaluated it", and a pill reading "unknown" would
 * make an absence look like a finding. The text itself is
 * {@link calcRuntimePillLabel}'s, which is where the pure spec gates it.
 */
function CalcRuntimePill({ runtime }: { runtime: AssetPointCalcConfigDto["runtime"] }) {
  const label = calcRuntimePillLabel(runtime, Date.now());
  if (label === null) {
    return null;
  }
  const tone =
    runtime?.lastOutcome === "skipped" ? "bg-critical-wash-strong text-critical-ink-strong" : "bg-accent/10 text-accent-strong";
  return <span className={`rounded px-2 py-0.5 font-semibold ${tone}`}>{label}</span>;
}

/**
 * ADR 0056 Amendment 3 part A (`F2.25`) — one metadata cell: the effective
 * value, and an "inherited" marker where the shown value comes from the
 * asset's template. The title names the template-supplied fields.
 */
function MetadataCell({
  text,
  effective,
  fields,
}: {
  text: string;
  effective: EffectivePointMetadata;
  fields: readonly MetadataField[];
}) {
  const parts = inheritedParts(effective, fields);
  return (
    <td className="px-2 py-2 text-xs">
      {text}
      {parts === "none" ? null : (
        <span
          className="ml-1 rounded bg-accent/10 px-1 text-[10px] text-accent-strong"
          title={`From the template: ${inheritedFields(effective, fields).join(", ")}`}
        >
          {parts === "all" ? "inherited" : "partly inherited"}
        </span>
      )}
    </td>
  );
}

/** The Scale, Range and Quality cells of one row, from the effective five. */
function EffectiveMetadataCells({ item }: { item: AdminAssetPointDto }) {
  const effective = effectivePointMetadata(item);
  return (
    <>
      <MetadataCell text={scaleCell(effective.value)} effective={effective} fields={SCALE_FIELDS} />
      <MetadataCell text={rangeCell(effective.value)} effective={effective} fields={RANGE_FIELDS} />
      <MetadataCell text={qualityCell(effective.value)} effective={effective} fields={QUALITY_FIELDS} />
    </>
  );
}

type AssetPointsAdminPageProps = { user: AuthUser };

/** Admin screen for asset point mappings with asset drill-down. */
export function AssetPointsAdminPage({ user }: AssetPointsAdminPageProps) {
  const { assetId } = useParams();
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState<MasterDataActiveFilter>("all");
  const [selection, setSelection] = useState<HierarchySelection>({ assetId });
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminAssetPointDto | null>(null);
  const [form, setForm] = useState<AssetPointForm>(() => emptyAssetPointForm(assetId ?? ""));
  const [error, setError] = useState<string | null>(null);
  // `F2.7` / ADR 0056 decision 8 — the rows "Edit selected" applies to.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  const assetSummaryQ = useQuery({
    queryKey: ["admin", "asset-summary", assetId],
    queryFn: () => fetchAdminAssetSummary(assetId ?? ""),
    enabled: Boolean(assetId),
  });

  useEffect(() => {
    if (assetId && assetSummaryQ.data) {
      setSelection({
        organizationId: assetSummaryQ.data.organizationId ?? undefined,
        locationId: assetSummaryQ.data.locationId ?? undefined,
        // ADR 0018: an asset need not have a gateway. `undefined` leaves the
        // RTU filter unset rather than selecting a non-existent one.
        rtuId: assetSummaryQ.data.rtuId ?? undefined,
        assetId,
      });
      setForm((current) => ({ ...current, assetId }));
    }
  }, [assetId, assetSummaryQ.data]);


  // ---- F2.6: per-asset calc overrides (ADR 0039 decisions 6-8) -------------
  //
  // Scoped to a single asset on purpose. `assetId` comes from the route, so
  // this section only appears on the asset drill-down — an override is a
  // property of one asset's point, and the unfiltered mapping list has no
  // asset to attach it to.
  const [openPointKey, setOpenPointKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<OverrideDraft>(EMPTY_DRAFT);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const calcPointsQ = useQuery({
    queryKey: ["admin", "asset-calc-points", assetId],
    queryFn: () => fetchAdminAssetCalcPoints(assetId ?? ""),
    enabled: Boolean(assetId),
  });
  const calcPoints = calcPointsQ.data?.items ?? [];

  function afterOverride() {
    setOpenPointKey(null);
    setDraft(EMPTY_DRAFT);
    setOverrideError(null);
    void queryClient.invalidateQueries({ queryKey: ["admin", "asset-calc-points"] });
    // The eager create (decision 7) adds an `asset_points` row, so the mapping
    // table above is stale too.
    void queryClient.invalidateQueries({ queryKey: ["admin", "asset-points"] });
  }

  const setOverrideM = useMutation({
    mutationFn: (pointKey: string) =>
      setAdminAssetPointCalcOverride(assetId ?? "", pointKey, draftToBody(draft)),
    onSuccess: afterOverride,
    onError: (cause: Error) => setOverrideError(apiErrorMessage(cause)),
  });

  const clearOverrideM = useMutation({
    mutationFn: (pointKey: string) => clearAdminAssetPointCalcOverride(assetId ?? "", pointKey),
    onSuccess: afterOverride,
    onError: (cause: Error) => setOverrideError(apiErrorMessage(cause)),
  });

  const catalogQ = useQuery({
    // `F3.39`: one fleet-wide catalog, so no organization in the key and no
    // organization to wait for before fetching it.
    queryKey: ["admin", "point-keys", "true"],
    queryFn: () => fetchAdminPointKeys("true"),
    enabled: modalOpen,
  });

  const listQ = useQuery({
    queryKey: ["admin", "asset-points", activeFilter, assetId, selection.locationId],
    queryFn: () =>
      fetchAdminAssetPoints(
        activeFilter,
        assetId ?? selection.assetId ?? undefined,
        selection.locationId,
      ),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = listQ.data?.items ?? [];
    if (!q) return items;
    return items.filter(
      (item) =>
        item.pointKey.toLowerCase().includes(q) ||
        item.sourceDataKey.toLowerCase().includes(q) ||
        item.assetCode.toLowerCase().includes(q),
    );
  }, [listQ.data?.items, search]);

  /**
   * The selection is cleared whenever the row set under it changes — the filter
   * bar, the active filter and the search box all narrow `filtered`, and
   * select-all runs over `filtered`. A selection that survived a search would
   * send ids that are no longer on screen.
   */
  useEffect(() => {
    setSelectedIds(new Set());
    setBulkOpen(false);
  }, [activeFilter, search, selection.locationId, selection.assetId]);

  // Derived from `filtered`, never from the raw id set: a row that leaves the
  // list must leave the count and the request with it.
  const selectedRows = useMemo(
    () => filtered.filter((item) => selectedIds.has(item.id)),
    [filtered, selectedIds],
  );
  const allFilteredSelected = filtered.length > 0 && selectedRows.length === filtered.length;

  function toggleRow(id: string, checked: boolean): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      // ADR 0056 Amendment 3 part A (`F2.31`): an edit sends the diff against
      // the loaded row (`editBodyFrom`), so the API's `statedPointMetadata`
      // sees only what the operator changed.
      if (editing) {
        return updateAdminAssetPoint(editing.id, editBodyFrom(editing, form));
      }
      return createAdminAssetPoint(createBodyFrom(form));
    },
    onSuccess: async () => {
      closeDialog();
      await queryClient.invalidateQueries({ queryKey: ["admin", "asset-points"] });
    },
    onError: (err: unknown) => setError(apiErrorMessage(err)),
  });

  function closeDialog(): void {
    setModalOpen(false);
    setEditing(null);
    setError(null);
  }

  const toggleMutation = useMutation({
    mutationFn: async (item: AdminAssetPointDto) =>
      item.active ? deactivateAdminAssetPoint(item.id) : reactivateAdminAssetPoint(item.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "asset-points"] });
    },
  });

  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Asset Points"
        subtitle="Map source data keys to catalog point keys per asset"
        actions={
          <div className="flex gap-2">
            {/* `F3.39`: the catalog is fleet-wide, so the link carries no
                organization and is always available. */}
            <Link
              to="/admin/point-keys"
              className="surface-button px-3 py-2"
            >
              Manage catalog
            </Link>
            <button
              type="button"
              className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent"
              onClick={() => {
                setEditing(null);
                setForm(emptyAssetPointForm(assetId ?? selection.assetId ?? ""));
                setModalOpen(true);
              }}
            >
              Add mapping
            </button>
          </div>
        }
      />
      <SectionCard title="Point mappings" bodyClassName="p-3 space-y-3">
        <div className="flex flex-wrap gap-3">
          <ActiveFilterBar value={activeFilter} onChange={setActiveFilter} />
          <HierarchyFilterBar
            user={user}
            levels={["organization", "location", "rtu", "asset"]}
            selection={selection}
            onNavigate={setSelection}
            // The bar's default drills *down* the master-data routes: choosing an
            // organization left this page for its locations list, and choosing
            // a location for its RTUs — so the location-scoped mapping sheet and
            // the download button below were unreachable by clicking (PR 2
            // step 6). This page filters in place, as the template detail and
            // manual-readings pages already do.
            syncRoutes={false}
          />
          <input
            className="surface-field px-3 py-1.5 text-sm"
            placeholder="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {/* `F2.7` / ADR 0056 decision 8. The count comes from the rows still
              on screen, so it cannot promise an edit to a row the filter
              dropped. */}
          <button
            type="button"
            className="surface-button px-3 py-1.5 disabled:opacity-50"
            disabled={selectedRows.length === 0}
            onClick={() => setBulkOpen(true)}
          >
            Edit selected ({selectedRows.length})
          </button>
        </div>
        {bulkOpen && selectedRows.length > 0 ? (
          <AssetPointBulkEditPanel
            ids={selectedRows.map((item) => item.id)}
            onApplied={() => {
              setBulkOpen(false);
              setSelectedIds(new Set());
            }}
            onCancel={() => setBulkOpen(false)}
          />
        ) : null}
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-ink-muted">
              <th className="px-2 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={allFilteredSelected}
                  onChange={(event) =>
                    setSelectedIds(
                      event.target.checked ? new Set(filtered.map((item) => item.id)) : new Set(),
                    )
                  }
                />
              </th>
              <th className="px-2 py-2">Asset</th>
              <th className="px-2 py-2">Point key</th>
              <th className="px-2 py-2">Source key</th>
              <th className="px-2 py-2">Sensor</th>
              <th className="px-2 py-2">Unit</th>
              <th className="px-2 py-2">Scale</th>
              <th className="px-2 py-2">Range</th>
              <th className="px-2 py-2">Quality</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id} className="border-b border-well-deep">
                <td className="px-2 py-2">
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.assetCode} ${item.pointKey}`}
                    checked={selectedIds.has(item.id)}
                    onChange={(event) => toggleRow(item.id, event.target.checked)}
                  />
                </td>
                <td className="px-2 py-2">{item.assetCode}</td>
                <td className="px-2 py-2 font-mono">{item.pointKey}</td>
                <td className="px-2 py-2 font-mono">{item.sourceDataKey}</td>
                <td className="px-2 py-2">{item.sensorCode ?? "—"}</td>
                <td className="px-2 py-2">{item.unit ?? "—"}</td>
                <EffectiveMetadataCells item={item} />
                <td className="px-2 py-2">
                  <StatusPill
                    label={item.active ? "Active" : "Inactive"}
                    tone={item.active ? "ok" : "offline"}
                  />
                </td>
                <td className="px-2 py-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs font-semibold text-accent-strong"
                      onClick={() => {
                        setEditing(item);
                        setForm(formFrom(item));
                        setModalOpen(true);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-xs font-semibold text-ink-muted"
                      onClick={() => toggleMutation.mutate(item)}
                    >
                      {item.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-ink-muted">
          Scale, Range and Quality show the value applied to readings. <em>inherited</em> means the
          asset follows its template&apos;s default.
        </p>
      </SectionCard>

      {/* `F2.7` (ADR 0056 decisions 6 and 7): the sheet is a location document
          — one location's assets, one workbook — so it appears only once a
          location is chosen. */}
      {/* Keyed by location: the panel holds a chosen file and the preview taken
          against it, and both belong to one location. Without the key, changing
          location kept the previous location's preview mounted (post-merge
          review, finding 3). */}
      {selection.locationId ? (
        <MappingSheetPanel key={selection.locationId} locationId={selection.locationId} />
      ) : null}

      {/* `F2.6` (ADR 0039 decision 8): overrides live on the asset, per point.
          Only rendered on the asset drill-down — an override belongs to one
          asset's point, and the unfiltered mapping list has no asset to attach
          it to. Derived points only; the API lists no others, because a
          measured point has no calc configuration to override. */}
      {assetId && calcPoints.length > 0 ? (
        <SectionCard title="Calculated points" bodyClassName="p-3 space-y-3">
          <p className="text-xs text-ink-muted">
            These points are computed from this asset&apos;s template. An override changes one
            setting for this asset only; everything left empty keeps following the template.
          </p>
          {overrideError ? <p className="text-xs text-critical-ink">{overrideError}</p> : null}
          {calcPoints.map((config) =>
            openPointKey === config.pointKey ? (
              <PointCalcOverridePanel
                key={config.pointKey}
                config={config}
                draft={draft}
                saving={setOverrideM.isPending}
                clearing={clearOverrideM.isPending}
                onDraftChange={setDraft}
                onSave={() => setOverrideM.mutate(config.pointKey)}
                onClear={() => clearOverrideM.mutate(config.pointKey)}
                onCancel={() => {
                  setOpenPointKey(null);
                  setOverrideError(null);
                }}
              />
            ) : (
              <div
                key={config.pointKey}
                className="flex flex-wrap items-center justify-between gap-2 surface-raised-sm px-3 py-2"
              >
                <span className="text-sm">
                  {config.label ?? config.pointKey}{" "}
                  <span className="font-mono text-xs text-ink-muted">{config.pointKey}</span>
                </span>
                <span className="flex items-center gap-3 text-xs text-ink-muted">
                  <span>
                    {config.effective.calcTrigger ?? "no trigger"}
                    {config.effective.calcIntervalSeconds === null
                      ? ""
                      : ` · every ${config.effective.calcIntervalSeconds}s`}
                  </span>
                  <CalcRuntimePill runtime={config.runtime} />
                  {hasAnyOverride(config) ? (
                    <span className="rounded bg-warning-wash-strong px-2 py-0.5 font-semibold text-warning-ink">
                      overridden
                    </span>
                  ) : (
                    <span>following the template</span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      // Seeded from the override, never from the template —
                      // seeding from the template would silently convert an
                      // inherited column into an override on the next save.
                      setDraft(draftFromConfig(config));
                      setOpenPointKey(config.pointKey);
                      setOverrideError(null);
                    }}
                    className="surface-button px-3 py-1"
                  >
                    {hasAnyOverride(config) ? "Edit override" : "Override"}
                  </button>
                </span>
              </div>
            ),
          )}
        </SectionCard>
      ) : null}

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4">
          <form
            className="w-full max-w-lg surface-dialog p-4"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              // `F2.31`: an edit that changed nothing has nothing to send.
              if (editing && Object.keys(editBodyFrom(editing, form)).length === 0) {
                closeDialog();
                return;
              }
              saveMutation.mutate();
            }}
          >
            <h2 className="font-condensed text-lg font-bold">
              {editing ? "Edit mapping" : "Add mapping"}
            </h2>
            <div className="mt-3 grid gap-3">
              <label className="block text-xs font-semibold text-ink-muted">
                Point key
                <select
                  className="mt-1 w-full surface-field px-3 py-2 text-sm"
                  value={form.pointKey}
                  required
                  onChange={(event) => {
                    const selected = (catalogQ.data?.items ?? []).find(
                      (item) => item.code === event.target.value,
                    );
                    setForm({
                      ...form,
                      pointKey: event.target.value,
                      unit: selected?.unit ?? form.unit,
                    });
                  }}
                >
                  <option value="">Select catalog point key</option>
                  {(catalogQ.data?.items ?? []).map((item) => (
                    <option key={item.id} value={item.code}>
                      {item.code} · {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold text-ink-muted">
                Source data key
                <input
                  className="mt-1 w-full surface-field px-3 py-2 text-sm"
                  value={form.sourceDataKey}
                  required
                  onChange={(event) => setForm({ ...form, sourceDataKey: event.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-ink-muted">
                Sensor code
                <input
                  className="mt-1 w-full surface-field px-3 py-2 text-sm"
                  value={form.sensorCode}
                  onChange={(event) => setForm({ ...form, sensorCode: event.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-ink-muted">
                Unit
                <input
                  className="mt-1 w-full surface-field px-3 py-2 text-sm"
                  value={form.unit}
                  onChange={(event) => setForm({ ...form, unit: event.target.value })}
                />
              </label>
              {/* `F2.7` / ADR 0056 decision 1 — the per-asset override of the
                  five. Empty means "follow the template", which is an omitted
                  field on a create and an explicit `null` on an edit
                  (`asset-point-form.ts`; an edit sends only a changed box). */}
              <p className="text-[11px] text-ink-muted">
                Leave a field below empty to follow this asset&apos;s template default. Clearing one
                on an existing mapping puts it back on the template.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-semibold text-ink-muted">
                  Scale multiplier
                  <input
                    type="number"
                    step="any"
                    aria-label="Scale multiplier"
                    className="mt-1 w-full surface-field px-3 py-2 text-sm"
                    value={form.scaleMultiplier}
                    onChange={(event) => setForm({ ...form, scaleMultiplier: event.target.value })}
                  />
                </label>
                <label className="block text-xs font-semibold text-ink-muted">
                  Scale offset
                  <input
                    type="number"
                    step="any"
                    aria-label="Scale offset"
                    className="mt-1 w-full surface-field px-3 py-2 text-sm"
                    value={form.scaleOffset}
                    onChange={(event) => setForm({ ...form, scaleOffset: event.target.value })}
                  />
                </label>
                <label className="block text-xs font-semibold text-ink-muted">
                  Engineering minimum
                  <input
                    type="number"
                    step="any"
                    aria-label="Engineering minimum"
                    className="mt-1 w-full surface-field px-3 py-2 text-sm"
                    value={form.engMin}
                    onChange={(event) => setForm({ ...form, engMin: event.target.value })}
                  />
                </label>
                <label className="block text-xs font-semibold text-ink-muted">
                  Engineering maximum
                  <input
                    type="number"
                    step="any"
                    aria-label="Engineering maximum"
                    className="mt-1 w-full surface-field px-3 py-2 text-sm"
                    value={form.engMax}
                    onChange={(event) => setForm({ ...form, engMax: event.target.value })}
                  />
                </label>
                <label className="block text-xs font-semibold text-ink-muted">
                  Quality policy
                  <select
                    aria-label="Quality policy"
                    className="mt-1 w-full surface-field px-3 py-2 text-sm"
                    value={form.qualityPolicy}
                    onChange={(event) =>
                      setForm({ ...form, qualityPolicy: event.target.value as QualityPolicy | "" })
                    }
                  >
                    {/* The two policies are `packages/shared`'s vocabulary,
                        never a second list of options (§4.8). */}
                    <option value="">Follow the template</option>
                    {QUALITY_POLICIES.map((policy) => (
                      <option key={policy} value={policy}>
                        {policy}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            {error ? <div className="mt-2 text-xs text-critical-ink">{error}</div> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="surface-button px-3 py-2"
                onClick={() => setModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </MasterDataLayout>
  );
}
