import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { AdminRtuDto, CreateRtuBody, MasterDataActiveFilter, UpdateRtuBody } from "@bms/shared";

import { fetchAdminLocationSummary } from "../../api/admin/locations";
import {
  createAdminRtu,
  deactivateAdminRtu,
  fetchAdminRtus,
  reactivateAdminRtu,
  updateAdminRtu,
} from "../../api/admin/rtus";
import { ActiveFilterBar } from "../../components/admin/active-filter-bar";
import {
  HierarchyFilterBar,
  type HierarchySelection,
} from "../../components/admin/hierarchy-filter-bar";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { RtuStatusWizard, RtuWizard } from "../../components/admin/rtu-wizards";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { apiErrorMessage } from "../../lib/api-error-message";
import type { AuthUser } from "../../stores/auth-store";

type RtusAdminPageProps = { user: AuthUser };

/**
 * Admin screen for RTU master data with location drill-down.
 *
 * `F3.86` PR 3a (ADR 0099 decision 6) — Add and Edit are the `rtu.create`
 * and `rtu.update` wizards, and Deactivate and Reactivate are Review-only
 * wizards (ruling Q9); all four live in `components/admin/rtu-wizards.tsx`.
 * This page sends what Review parsed, with no `X-Copilot-Change` header.
 */
export function RtusAdminPage({ user }: RtusAdminPageProps) {
  const { locationId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState<MasterDataActiveFilter>("all");
  const [selection, setSelection] = useState<HierarchySelection>({ locationId });
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRtuDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** `F3.86` PR 3a — the RTU whose deactivate or reactivate wizard is open. */
  const [statusTarget, setStatusTarget] = useState<AdminRtuDto | null>(null);

  const locationSummaryQ = useQuery({
    queryKey: ["admin", "location-summary", locationId],
    queryFn: () => fetchAdminLocationSummary(locationId ?? ""),
    enabled: Boolean(locationId),
  });

  useEffect(() => {
    if (locationId) {
      setSelection({
        organizationId: locationSummaryQ.data?.organizationId,
        locationId,
      });
    }
  }, [locationId, locationSummaryQ.data?.organizationId]);

  const listQ = useQuery({
    queryKey: ["admin", "rtus", activeFilter, locationId ?? selection.locationId],
    queryFn: () =>
      fetchAdminRtus(activeFilter, locationId ?? selection.locationId ?? undefined),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = listQ.data?.items ?? [];
    if (!q) return items;
    return items.filter(
      (item) =>
        item.code.toLowerCase().includes(q) || item.displayName.toLowerCase().includes(q),
    );
  }, [listQ.data?.items, search]);

  const saveMutation = useMutation({
    // The body the wizard's Review parsed: what Review showed is what is sent.
    mutationFn: async (body: Record<string, unknown>) => {
      if (editing) return updateAdminRtu(editing.id, body as UpdateRtuBody);
      return createAdminRtu(body as CreateRtuBody);
    },
    onSuccess: async () => {
      setModalOpen(false);
      setEditing(null);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "rtus"] });
    },
    onError: (err: Error) => setError(apiErrorMessage(err)),
  });

  const toggleMutation = useMutation({
    mutationFn: async (item: AdminRtuDto) =>
      item.active ? deactivateAdminRtu(item.id) : reactivateAdminRtu(item.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "rtus"] });
    },
  });

  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="RTUs"
        subtitle="Gateways and domain simulators under locations"
        actions={
          <button
            type="button"
            className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent"
            onClick={() => {
              setEditing(null);
              setError(null);
              setModalOpen(true);
            }}
          >
            Add RTU
          </button>
        }
      />
      <SectionCard title="RTU list" bodyClassName="p-3 space-y-3">
        <div className="flex flex-wrap gap-3">
          <ActiveFilterBar value={activeFilter} onChange={setActiveFilter} />
          <HierarchyFilterBar
            user={user}
            levels={["organization", "location"]}
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
              <th className="px-2 py-2">Location</th>
              <th className="px-2 py-2">Code</th>
              <th className="px-2 py-2">Name</th>
              <th className="px-2 py-2">Source</th>
              <th className="px-2 py-2">Device ID</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer border-b border-well-deep hover:bg-well"
                onClick={() =>
                  navigate(`/admin/locations/${item.locationId}/rtus/${item.id}/assets`)
                }
              >
                <td className="px-2 py-2">{item.locationName}</td>
                <td className="px-2 py-2 font-mono">{item.code}</td>
                <td className="px-2 py-2 font-semibold text-accent-strong">{item.displayName}</td>
                <td className="px-2 py-2">{item.sourceType}</td>
                <td className="px-2 py-2 font-mono">{item.rtuCode || "—"}</td>
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
                        setModalOpen(true);
                      }}
                    >
                      Edit
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

      {modalOpen ? (
        <RtuWizard
          key={editing?.id ?? "create"}
          editing={editing}
          locationId={locationId ?? selection.locationId ?? ""}
          organizationId={selection.organizationId}
          pending={saveMutation.isPending}
          error={error}
          onSubmit={(body) => saveMutation.mutate(body)}
          onCancel={() => setModalOpen(false)}
        />
      ) : null}

      {statusTarget ? (
        <RtuStatusWizard
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
