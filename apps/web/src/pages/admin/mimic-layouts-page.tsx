import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { MIMIC_PRESETS, type MimicLayoutSummaryDto, type MimicPreset } from "@bms/shared";
import { mimicPresetSchema } from "@bms/shared/contracts";

import { deleteMimicLayout, fetchMimicLayouts } from "../../api/mimic-layouts";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { canManageMimicLayouts } from "../../lib/admin-access";
import { apiErrorMessage } from "../../lib/api-error-message";
import type { AuthUser } from "../../stores/auth-store";

type MimicLayoutsPageProps = { user: AuthUser };

/** The list's query key; the editor page invalidates it after a save. */
export const MIMIC_LAYOUTS_QUERY_KEY = ["mimic-layouts"] as const;

/**
 * `F3.32c` U6c (ADR 0081 decision 3) — the organization's plant mimic layout library: the list,
 * New, "Start from" (decision 4), Open and Delete.
 *
 * **"Start from" offers every preset** (`F3.32d`, ADR 0082 decision 5, plan D8): a select over
 * `mimicPresetSchema.options` labelled by `MIMIC_PRESETS`, opening on `water_train`, and a Start
 * link to the new-layout route with the chosen preset. A link, not a button: it navigates and
 * writes nothing, so it has no pending state.
 *
 * **It fails closed at the page**, as `location-types-page.tsx` does. The tab and the rail entry
 * are hidden from every role but `admin` and `organization_admin`, but a typed URL still reaches
 * this route through `AdminRoute`, which admits every master-data role. For those roles the page
 * renders one status line and mounts no query.
 *
 * A Delete the server refuses (409 while a dashboard widget uses the layout) shows the server's
 * sentence, unwrapped by `apiErrorMessage`.
 */
export function MimicLayoutsPage({ user }: MimicLayoutsPageProps) {
  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Mimic Layouts"
        subtitle="Plant drawings a dashboard's mimic widget can show"
      />
      {canManageMimicLayouts(user.role) ? (
        <MimicLayoutLibrary />
      ) : (
        <p role="status" className="text-sm text-ink-muted">
          Mimic layouts are drawn by an administrator or an organization administrator.
        </p>
      )}
    </MasterDataLayout>
  );
}

function MimicLayoutLibrary() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startFrom, setStartFrom] = useState<MimicPreset>(mimicPresetSchema.options[0]);

  const listQ = useQuery({ queryKey: MIMIC_LAYOUTS_QUERY_KEY, queryFn: fetchMimicLayouts });

  const deleteM = useMutation({
    mutationFn: (id: string) => deleteMimicLayout(id),
    onSuccess: async () => {
      setConfirming(null);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: MIMIC_LAYOUTS_QUERY_KEY });
    },
    onError: (cause: Error) => {
      setConfirming(null);
      setError(apiErrorMessage(cause));
    },
  });

  const items = listQ.data?.items ?? [];

  return (
    <SectionCard title="Layout library" bodyClassName="p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <label className="flex items-center gap-2 text-xs font-semibold text-ink-muted">
          Start from
          <select
            aria-label="Start from"
            value={startFrom}
            onChange={(event) => {
              const chosen = mimicPresetSchema.safeParse(event.target.value);
              if (chosen.success) {
                setStartFrom(chosen.data);
              }
            }}
            className="rounded border border-line bg-surface px-2 py-2 text-xs text-ink"
          >
            {mimicPresetSchema.options.map((preset) => (
              <option key={preset} value={preset}>
                {MIMIC_PRESETS[preset].label}
              </option>
            ))}
          </select>
        </label>
        <Link
          to={`/admin/mimic-layouts/new?preset=${startFrom}`}
          className="rounded border border-line px-3 py-2 text-xs font-semibold text-ink"
        >
          Start
        </Link>
        <Link
          to="/admin/mimic-layouts/new"
          className="rounded bg-accent px-3 py-2 text-xs font-semibold text-on-accent"
        >
          New layout
        </Link>
      </div>
      {error !== null ? (
        <p role="alert" className="text-xs text-critical-ink">
          {error}
        </p>
      ) : null}
      {listQ.isError ? (
        <p role="alert" className="text-xs text-critical-ink">
          {apiErrorMessage(listQ.error)}
        </p>
      ) : null}
      {listQ.isSuccess && items.length === 0 ? (
        <p className="text-sm text-ink-muted">No layouts yet. Start from a preset, or draw a new one.</p>
      ) : null}
      {items.length > 0 ? (
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-ink-muted">
              <th className="px-2 py-2">Name</th>
              <th className="px-2 py-2">Slug</th>
              <th className="px-2 py-2">Units</th>
              <th className="px-2 py-2">Canvas</th>
              <th className="px-2 py-2">Version</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <LayoutRow
                key={item.id}
                item={item}
                confirming={confirming === item.id}
                deleting={deleteM.isPending}
                onAskDelete={() => {
                  setError(null);
                  setConfirming(item.id);
                }}
                onCancelDelete={() => setConfirming(null)}
                onConfirmDelete={() => deleteM.mutate(item.id)}
              />
            ))}
          </tbody>
        </table>
      ) : null}
    </SectionCard>
  );
}

type LayoutRowProps = {
  item: MimicLayoutSummaryDto;
  confirming: boolean;
  deleting: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
};

function LayoutRow({ item, confirming, deleting, onAskDelete, onCancelDelete, onConfirmDelete }: LayoutRowProps) {
  return (
    <tr className="border-b border-well-deep" data-layout-id={item.id}>
      <td className="px-2 py-2">{item.name}</td>
      <td className="px-2 py-2 font-mono">{item.slug}</td>
      <td className="px-2 py-2">{item.unitCount}</td>
      <td className="px-2 py-2">
        {item.canvasW} × {item.canvasH}
      </td>
      <td className="px-2 py-2">{item.version}</td>
      <td className="px-2 py-2">
        <div className="flex flex-wrap gap-2">
          <Link to={`/admin/mimic-layouts/${item.id}`} className="text-xs font-semibold text-accent">
            Open
          </Link>
          {confirming ? (
            <>
              <button
                type="button"
                disabled={deleting}
                aria-busy={deleting}
                onClick={onConfirmDelete}
                className="text-xs font-semibold text-critical-ink"
              >
                {deleting ? "Deleting…" : "Confirm delete"}
              </button>
              <button type="button" onClick={onCancelDelete} className="text-xs font-semibold text-ink-muted">
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={onAskDelete} className="text-xs font-semibold text-ink-muted">
              Delete
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
