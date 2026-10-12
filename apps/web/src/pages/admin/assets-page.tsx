import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { AdminAssetDto, MasterDataActiveFilter } from "@bms/shared";

import {
  createAdminAsset,
  deactivateAdminAsset,
  fetchAdminAssets,
  reactivateAdminAsset,
  updateAdminAsset,
} from "../../api/admin/assets";
import { fetchAdminLocationSummary } from "../../api/admin/locations";
import { fetchAdminRtuSummary } from "../../api/admin/rtus";
import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import { defaultDomainCode } from "../../lib/vocabulary";
import { ActiveFilterBar } from "../../components/admin/active-filter-bar";
import { AssetStatusWizard } from "../../components/admin/asset-status-wizard";
import { AssetWizard, emptyAssetForm, type AssetForm } from "../../components/admin/asset-wizard";
import {
  HierarchyFilterBar,
  type HierarchySelection,
} from "../../components/admin/hierarchy-filter-bar";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { AssetImagesPanel } from "../../components/assets/asset-images-panel";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { apiErrorMessage } from "../../lib/api-error-message";
import type { AuthUser } from "../../stores/auth-store";

type AssetsAdminPageProps = { user: AuthUser };

/**
 * Admin screen for asset master data with RTU drill-down.
 *
 * `F3.86` PR 3b (ADR 0099 decision 6) — Add and Edit are the `asset.create`
 * and `asset.update` wizards (`components/admin/asset-wizard.tsx`), and
 * Deactivate and Reactivate are Review-only wizards (ruling Q9,
 * `asset-status-wizard.tsx`). This page sends what Review parsed, with no
 * `X-Copilot-Change` header. The images panel stays beside them.
 */
export function AssetsAdminPage({ user }: AssetsAdminPageProps) {
  const { locationId, rtuId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState<MasterDataActiveFilter>("all");
  const [selection, setSelection] = useState<HierarchySelection>({ locationId, rtuId });
  const [search, setSearch] = useState("");
  /** The form a create opens with, or `null` while no create or edit is open. */
  const [opened, setOpened] = useState<AssetForm | null>(null);
  const [editing, setEditing] = useState<AdminAssetDto | null>(null);
  // `F3.4` (owner ruling Q-0): the asset whose image panel is docked open, or
  // `null`. One at a time — the panel is the right-hand dock, not a per-row
  // expansion, and the asset it names is the one whose action was pressed.
  const [imagesFor, setImagesFor] = useState<AdminAssetDto | null>(null);
  /** `F3.86` PR 3b — the asset whose deactivate or reactivate wizard is open. */
  const [statusTarget, setStatusTarget] = useState<AdminAssetDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ADR 0031 Amendment 1 — the plant vocabulary is data; a create opens on its first domain.
  const vocabQ = useQuery({
    queryKey: vocabulariesQueryKey,
    queryFn: fetchVocabularies,
    staleTime: 5 * 60 * 1000,
  });

  const locationSummaryQ = useQuery({
    queryKey: ["admin", "location-summary", locationId],
    queryFn: () => fetchAdminLocationSummary(locationId ?? ""),
    enabled: Boolean(locationId),
  });

  const rtuSummaryQ = useQuery({
    queryKey: ["admin", "rtu-summary", rtuId],
    queryFn: () => fetchAdminRtuSummary(rtuId ?? ""),
    enabled: Boolean(rtuId),
  });

  useEffect(() => {
    setSelection({
      organizationId:
        locationSummaryQ.data?.organizationId ?? rtuSummaryQ.data?.organizationId,
      locationId: locationId ?? rtuSummaryQ.data?.locationId,
      rtuId,
    });
  }, [
    locationId,
    rtuId,
    locationSummaryQ.data?.organizationId,
    rtuSummaryQ.data?.locationId,
    rtuSummaryQ.data?.organizationId,
  ]);

  const listQ = useQuery({
    queryKey: ["admin", "assets", activeFilter, locationId, rtuId],
    queryFn: () =>
      fetchAdminAssets(
        activeFilter,
        locationId ?? selection.locationId ?? undefined,
        rtuId ?? selection.rtuId ?? undefined,
      ),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = listQ.data?.items ?? [];
    if (!q) return items;
    return items.filter(
      (item) => item.code.toLowerCase().includes(q) || item.name.toLowerCase().includes(q),
    );
  }, [listQ.data?.items, search]);

  function close(): void {
    setOpened(null);
    setEditing(null);
    setError(null);
  }

  const saveMutation = useMutation({
    // The body the wizard's Review parsed: what Review showed is what is sent.
    mutationFn: async (body: Record<string, unknown>) => {
      if (editing) return updateAdminAsset(editing.id, body as Parameters<typeof updateAdminAsset>[1]);
      return createAdminAsset(body as Parameters<typeof createAdminAsset>[0]);
    },
    onSuccess: async () => {
      close();
      await queryClient.invalidateQueries({ queryKey: ["admin", "assets"] });
    },
    onError: (err: unknown) => setError(apiErrorMessage(err)),
  });

  const toggleMutation = useMutation({
    mutationFn: async (item: AdminAssetDto) =>
      item.active ? deactivateAdminAsset(item.id) : reactivateAdminAsset(item.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "assets"] });
    },
  });

  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Assets"
        subtitle="Devices under RTUs and locations"
        actions={
          <button
            type="button"
            className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent"
            onClick={() => {
              setEditing(null);
              setError(null);
              setOpened(
                emptyAssetForm(
                  locationId ?? selection.locationId ?? "",
                  rtuId ?? selection.rtuId ?? "",
                  defaultDomainCode(vocabQ.data?.assetDomains),
                ),
              );
            }}
          >
            Add asset
          </button>
        }
      />
      <SectionCard title="Asset list" bodyClassName="p-3 space-y-3">
        <div className="flex flex-wrap gap-3">
          <ActiveFilterBar value={activeFilter} onChange={setActiveFilter} />
          <HierarchyFilterBar
            user={user}
            levels={["organization", "location", "rtu"]}
            selection={selection}
            onNavigate={setSelection}
          />
          <input
            className="surface-field px-3 py-1.5 text-sm"
            placeholder="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-ink-muted">
              <th className="px-2 py-2">Code</th>
              <th className="px-2 py-2">Name</th>
              <th className="px-2 py-2">Location</th>
              <th className="px-2 py-2">RTU</th>
              <th className="px-2 py-2">Domain</th>
              <th className="px-2 py-2">Water balance</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer border-b border-well-deep hover:bg-well"
                onClick={() => navigate(`/admin/assets/${item.id}/points`)}
              >
                <td className="px-2 py-2 font-mono">{item.code}</td>
                <td className="px-2 py-2 font-semibold text-accent-strong">{item.name}</td>
                <td className="px-2 py-2">{item.locationName}</td>
                <td className="px-2 py-2">{item.rtuDisplayName}</td>
                <td className="px-2 py-2">{item.domain}</td>
                <td className="px-2 py-2">{item.waterBalanceRole ?? "—"}</td>
                <td className="px-2 py-2">
                  <StatusPill
                    label={item.active ? "Active" : "Inactive"}
                    tone={item.active ? "ok" : "offline"}
                  />
                </td>
                <td className="px-2 py-2" onClick={(event) => event.stopPropagation()}>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs font-semibold text-accent-strong"
                      onClick={() => {
                        setEditing(item);
                        setError(null);
                        setOpened(null);
                      }}
                    >
                      Edit
                    </button>
                    {/*
                      `F3.4` — inside this cell, whose `onClick` stops the
                      row's navigation to the points screen. Outside it, every
                      press would open the panel and leave the page at once.
                    */}
                    <button
                      type="button"
                      className="text-xs font-semibold text-accent-strong"
                      onClick={() => setImagesFor(item)}
                    >
                      Images
                    </button>
                    <button
                      type="button"
                      className="text-xs font-semibold text-ink-muted"
                      onClick={() => setStatusTarget(item)}
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

      {imagesFor !== null ? (
        <AssetImagesPanel asset={imagesFor} onClose={() => setImagesFor(null)} />
      ) : null}

      {editing !== null || opened !== null ? (
        <AssetWizard
          key={editing?.id ?? "create"}
          editing={editing}
          initial={opened ?? emptyAssetForm("", "", "")}
          organizationId={selection.organizationId}
          pending={saveMutation.isPending}
          error={error}
          onSubmit={(body) => saveMutation.mutate(body)}
          onCancel={close}
        />
      ) : null}

      {statusTarget ? (
        <AssetStatusWizard
          target={statusTarget}
          onCancel={() => setStatusTarget(null)}
          onSubmit={() => {
            setStatusTarget(null);
            toggleMutation.mutate(statusTarget);
          }}
        />
      ) : null}
    </MasterDataLayout>
  );
}
