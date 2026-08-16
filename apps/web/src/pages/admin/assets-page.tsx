import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
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
import { fetchAdminLocationSummary, fetchAdminLocations } from "../../api/admin/locations";
import { fetchAdminRtuSummary, fetchAdminRtus } from "../../api/admin/rtus";
import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import { defaultDomainCode } from "../../lib/vocabulary";
import { ActiveFilterBar } from "../../components/admin/active-filter-bar";
import {
  HierarchyFilterBar,
  type HierarchySelection,
} from "../../components/admin/hierarchy-filter-bar";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import type { AuthUser } from "../../stores/auth-store";

type AssetsAdminPageProps = { user: AuthUser };

/** Admin screen for asset master data with RTU drill-down. */
export function AssetsAdminPage({ user }: AssetsAdminPageProps) {
  const { locationId, rtuId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState<MasterDataActiveFilter>("all");
  const [selection, setSelection] = useState<HierarchySelection>({ locationId, rtuId });
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminAssetDto | null>(null);
  const [form, setForm] = useState({
    code: "",
    name: "",
    siteName: "",
    locationId: locationId ?? "",
    rtuId: rtuId ?? "",
    // A literal here and only here: this initializer runs before `vocabQ`
    // exists. The value is replaced by `defaultDomainCode` in the "Add asset"
    // handler below, which is what actually opens the form.
    domain: "electrical",
  });
  const [error, setError] = useState<string | null>(null);

  // ADR 0031 Amendment 1 — the plant vocabulary is data, so the form's options
  // are fetched. Same query key as the rules page: one nine-row payload, one
  // cache entry, and no chance of two screens offering different domains.
  const vocabQ = useQuery({
    queryKey: vocabulariesQueryKey,
    queryFn: fetchVocabularies,
    staleTime: 5 * 60 * 1000,
  });
  const assetDomains = vocabQ.data?.assetDomains ?? [];

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
    setForm((current) => ({
      ...current,
      locationId: locationId ?? current.locationId,
      rtuId: rtuId ?? current.rtuId,
    }));
  }, [
    locationId,
    rtuId,
    locationSummaryQ.data?.organizationId,
    rtuSummaryQ.data?.locationId,
    rtuSummaryQ.data?.organizationId,
  ]);

  const formLocationsQ = useQuery({
    queryKey: ["admin", "locations", "true", selection.organizationId],
    queryFn: () => fetchAdminLocations("true", selection.organizationId),
    enabled: modalOpen,
  });

  const formRtusQ = useQuery({
    queryKey: ["admin", "rtus", "true", form.locationId],
    queryFn: () => fetchAdminRtus("true", form.locationId || undefined),
    enabled: modalOpen && Boolean(form.locationId),
  });

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

  const saveMutation = useMutation({
    mutationFn: async () => {
      // ADR 0018: an empty select means "no gateway", not an empty uuid. The
      // API validates rtuId as `uuid().nullish()`, so "" is a 400.
      const payload = { ...form, rtuId: form.rtuId || null };
      if (editing) {
        return updateAdminAsset(editing.id, payload);
      }
      return createAdminAsset(payload);
    },
    onSuccess: async () => {
      setModalOpen(false);
      setEditing(null);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "assets"] });
    },
    onError: (err: Error) => setError(err.message),
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
            className="rounded bg-bms-green px-3 py-2 text-xs font-semibold text-white"
            onClick={() => {
              setEditing(null);
              setForm({
                code: "",
                name: "",
                siteName: "",
                locationId: locationId ?? selection.locationId ?? "",
                rtuId: rtuId ?? selection.rtuId ?? "",
                domain: defaultDomainCode(vocabQ.data?.assetDomains),
              });
              setModalOpen(true);
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
            className="rounded border px-3 py-1.5 text-sm"
            placeholder="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-bms-muted">
              <th className="px-2 py-2">Code</th>
              <th className="px-2 py-2">Name</th>
              <th className="px-2 py-2">Location</th>
              <th className="px-2 py-2">RTU</th>
              <th className="px-2 py-2">Domain</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
                onClick={() => navigate(`/admin/assets/${item.id}/points`)}
              >
                <td className="px-2 py-2 font-mono">{item.code}</td>
                <td className="px-2 py-2 font-semibold text-bms-green">{item.name}</td>
                <td className="px-2 py-2">{item.locationName}</td>
                <td className="px-2 py-2">{item.rtuDisplayName}</td>
                <td className="px-2 py-2">{item.domain}</td>
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
                      className="text-xs font-semibold text-bms-green"
                      onClick={() => {
                        setEditing(item);
                        setForm({
                          code: item.code,
                          name: item.name,
                          siteName: item.siteName,
                          locationId: item.locationId ?? "",
                          // ADR 0018: gateway is optional — an empty select
                          // means "no gateway", not "not yet loaded".
                          rtuId: item.rtuId ?? "",
                          domain: item.domain,
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
              {editing ? "Edit asset" : "Add asset"}
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-bms-muted">
                Code
                <input
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  value={form.code}
                  required
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-bms-muted">
                Name
                <input
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  value={form.name}
                  required
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-bms-muted sm:col-span-2">
                Site name
                <input
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  value={form.siteName}
                  required
                  onChange={(event) => setForm({ ...form, siteName: event.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-bms-muted sm:col-span-2">
                Location
                <select
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  value={form.locationId}
                  required
                  onChange={(event) =>
                    setForm({ ...form, locationId: event.target.value, rtuId: "" })
                  }
                >
                  <option value="">Select location</option>
                  {(formLocationsQ.data?.items ?? []).map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold text-bms-muted sm:col-span-2">
                RTU
                <select
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  value={form.rtuId}
                  onChange={(event) => setForm({ ...form, rtuId: event.target.value })}
                >
                  {/* ADR 0018: optional. An asset read off a dial or imported
                      from a workbook has no gateway, and `required` here made
                      that unrepresentable through the UI. */}
                  <option value="">No gateway — readings entered or imported</option>
                  {(formRtusQ.data?.items ?? []).map((rtu) => (
                    <option key={rtu.id} value={rtu.id}>
                      {rtu.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold text-bms-muted sm:col-span-2">
                Domain
                {/*
                  A <select> over the live vocabulary, not free text (ADR 0031).
                  `assets_domain_fk` closed this set in migration 0029, so a
                  typed value could only ever come back as a rejection — and the
                  field gave no hint what the valid codes were. Options are
                  fetched, never restated, for the same reason the rule
                  builder's are (§4.8): a hand-kept list that falls behind does
                  not render as broken, it renders as the wrong value.
                */}
                <select
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  value={form.domain}
                  required
                  onChange={(event) => setForm({ ...form, domain: event.target.value })}
                >
                  {assetDomains.map((domain) => (
                    <option key={domain.code} value={domain.code}>
                      {domain.label}
                    </option>
                  ))}
                </select>
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
