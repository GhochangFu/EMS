import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { AdminAssetPointDto, MasterDataActiveFilter } from "@bms/shared";

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
import { PointCalcOverridePanel } from "../../components/assets/point-calc-override-panel";
import { SectionCard } from "../../components/section-card";
import { apiErrorMessage } from "../../lib/api-error-message";
import {
  draftFromConfig,
  draftToBody,
  hasAnyOverride,
  EMPTY_DRAFT,
  type OverrideDraft,
} from "../../lib/asset-point-calc-override";
import { StatusPill } from "../../components/status-pill";
import type { AuthUser } from "../../stores/auth-store";

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
  const [form, setForm] = useState({
    assetId: assetId ?? "",
    pointKey: "",
    sourceDataKey: "",
    sensorCode: "",
    unit: "",
  });
  const [error, setError] = useState<string | null>(null);

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

  const overrideBusy = setOverrideM.isPending || clearOverrideM.isPending;

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

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        assetId: form.assetId,
        pointKey: form.pointKey,
        sourceDataKey: form.sourceDataKey,
        sensorCode: form.sensorCode || undefined,
        unit: form.unit || undefined,
      };
      if (editing) {
        const { assetId: _assetId, ...updatePayload } = payload;
        return updateAdminAssetPoint(editing.id, updatePayload);
      }
      return createAdminAssetPoint(payload);
    },
    onSuccess: async () => {
      setModalOpen(false);
      setEditing(null);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "asset-points"] });
    },
    onError: (err: Error) => setError(err.message),
  });

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
              className="rounded border border-gray-200 px-3 py-2 text-xs font-semibold text-bms-ink"
            >
              Manage catalog
            </Link>
            <button
              type="button"
              className="rounded bg-bms-green px-3 py-2 text-xs font-semibold text-white"
              onClick={() => {
                setEditing(null);
                setForm({
                  assetId: assetId ?? selection.assetId ?? "",
                  pointKey: "",
                  sourceDataKey: "",
                  sensorCode: "",
                  unit: "",
                });
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
          />
          <input
            className="rounded border px-3 py-1.5 text-sm"
            placeholder="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-bms-muted">
              <th className="px-2 py-2">Asset</th>
              <th className="px-2 py-2">Point key</th>
              <th className="px-2 py-2">Source key</th>
              <th className="px-2 py-2">Sensor</th>
              <th className="px-2 py-2">Unit</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id} className="border-b border-gray-100">
                <td className="px-2 py-2">{item.assetCode}</td>
                <td className="px-2 py-2 font-mono">{item.pointKey}</td>
                <td className="px-2 py-2 font-mono">{item.sourceDataKey}</td>
                <td className="px-2 py-2">{item.sensorCode ?? "—"}</td>
                <td className="px-2 py-2">{item.unit ?? "—"}</td>
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
                      className="text-xs font-semibold text-bms-green"
                      onClick={() => {
                        setEditing(item);
                        setForm({
                          assetId: item.assetId,
                          pointKey: item.pointKey,
                          sourceDataKey: item.sourceDataKey,
                          sensorCode: item.sensorCode ?? "",
                          unit: item.unit ?? "",
                        });
                        setModalOpen(true);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-xs font-semibold text-bms-muted"
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
      </SectionCard>

      {/* `F2.6` (ADR 0039 decision 8): overrides live on the asset, per point.
          Only rendered on the asset drill-down — an override belongs to one
          asset's point, and the unfiltered mapping list has no asset to attach
          it to. Derived points only; the API lists no others, because a
          measured point has no calc configuration to override. */}
      {assetId && calcPoints.length > 0 ? (
        <SectionCard title="Calculated points" bodyClassName="p-3 space-y-3">
          <p className="text-xs text-bms-muted">
            These points are computed from this asset&apos;s template. An override changes one
            setting for this asset only; everything left empty keeps following the template.
          </p>
          {overrideError ? <p className="text-xs text-red-700">{overrideError}</p> : null}
          {calcPoints.map((config) =>
            openPointKey === config.pointKey ? (
              <PointCalcOverridePanel
                key={config.pointKey}
                config={config}
                draft={draft}
                busy={overrideBusy}
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
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-200 px-3 py-2"
              >
                <span className="text-sm">
                  {config.label ?? config.pointKey}{" "}
                  <span className="font-mono text-xs text-bms-muted">{config.pointKey}</span>
                </span>
                <span className="flex items-center gap-3 text-xs text-bms-muted">
                  <span>
                    {config.effective.calcTrigger ?? "no trigger"}
                    {config.effective.calcIntervalSeconds === null
                      ? ""
                      : ` · every ${config.effective.calcIntervalSeconds}s`}
                  </span>
                  {hasAnyOverride(config) ? (
                    <span className="rounded bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
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
                    className="rounded border border-gray-200 px-3 py-1 font-semibold text-bms-ink"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            className="w-full max-w-lg rounded-lg border bg-white p-4"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              saveMutation.mutate();
            }}
          >
            <h2 className="font-condensed text-lg font-bold">
              {editing ? "Edit mapping" : "Add mapping"}
            </h2>
            <div className="mt-3 grid gap-3">
              <label className="block text-xs font-semibold text-bms-muted">
                Point key
                <select
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
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
              <label className="block text-xs font-semibold text-bms-muted">
                Source data key
                <input
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  value={form.sourceDataKey}
                  required
                  onChange={(event) => setForm({ ...form, sourceDataKey: event.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-bms-muted">
                Sensor code
                <input
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  value={form.sensorCode}
                  onChange={(event) => setForm({ ...form, sensorCode: event.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-bms-muted">
                Unit
                <input
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  value={form.unit}
                  onChange={(event) => setForm({ ...form, unit: event.target.value })}
                />
              </label>
            </div>
            {error ? <div className="mt-2 text-xs text-red-700">{error}</div> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded border px-3 py-2 text-xs"
                onClick={() => setModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded bg-bms-green px-3 py-2 text-xs font-semibold text-white"
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
