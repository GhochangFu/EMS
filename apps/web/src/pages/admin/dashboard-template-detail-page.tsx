/**
 * The section dashboard template detail screen (`F3.36` Part F, ADR 0049).
 *
 * The canvas, from `dashboard-canvas.tsx` (`F3.1d`) — the same grid the live
 * dashboard builder renders through, because a template widget draws through
 * exactly the same renderer components; only the *binding* differs (ADR 0049
 * decision 4). Widgets bind an asset-group role plus a point key, through
 * `AssetRoleBindingPicker`, rather than a live point id.
 *
 * **Lifecycle buttons are derived from `TEMPLATE_LIFECYCLE_TRANSITIONS`
 * (`canTransition`, `canOpenDraftFrom`, `canMutate`), never a second copy of
 * the rule** — `tests/f3.36-template-lifecycle-single-source.test.ts` fails
 * the build on a restated status array.
 *
 * **The instantiate dialog renders the resolution report unconditionally on
 * success** (ADR 0049 Amendment 2 decision 1) — every widget's
 * `matchedMembers`, `boundPoints` and `outcome`, named by `widgetKey`. Decision
 * 6 names this dialog as where an administrator maps an unresolved widget by
 * hand: *"a page that can list exactly which ones need it"*. A report the
 * administrator never sees is the silent success the amendment exists to
 * prevent.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  DASHBOARD_GRID,
  canMutate,
  canOpenDraftFrom,
  canTransition,
} from "@bms/shared";
import type {
  DashboardTemplateDto,
  InstantiateSectionTemplateResponse,
  TemplateWidgetResolutionDto,
} from "@bms/shared";

import {
  archiveAdminDashboardTemplate,
  createDraftFromAdminDashboardTemplate,
  deleteAdminDashboardTemplateDraft,
  fetchAdminDashboardTemplate,
  instantiateAdminDashboardTemplate,
  publishAdminDashboardTemplate,
  updateAdminDashboardTemplate,
} from "../../api/admin/dashboard-templates";
import type {
  SectionTemplateWidgetInput,
} from "../../api/admin/dashboard-templates";
import { fetchAdminAssetGroups } from "../../api/admin/asset-groups";
import { AssetRoleBindingPicker } from "../../components/dashboards/asset-role-binding-picker";
import { DashboardCanvas } from "../../components/dashboards/dashboard-canvas";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { apiErrorMessage } from "../../lib/api-error-message";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { statusTone } from "../../lib/template-lifecycle";
import { canAuthorTemplates, canInstantiateTemplates } from "../../lib/template-authoring-access";
import type { AuthUser } from "../../stores/auth-store";

type DashboardTemplateDetailPageProps = { user: AuthUser };

let nextWidgetOrdinal = 1;
/** A stable, template-local widget key an author never has to type — see
 * `sectionTemplateWidgetIdentitySchema`'s docblock on why `key` exists at
 * all. Timestamp-prefixed so a fresh session's counter cannot collide with a
 * key a previous session already saved. */
function freshWidgetKey(): string {
  return `widget-${Date.now()}-${nextWidgetOrdinal++}`;
}

/** Admin screen for one section dashboard template version. */
export function DashboardTemplateDetailPage({ user }: DashboardTemplateDetailPageProps) {
  const { templateId } = useParams();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<SectionTemplateWidgetInput[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [instantiateOpen, setInstantiateOpen] = useState(false);

  const templateQ = useQuery({
    queryKey: ["admin", "dashboard-template", templateId],
    queryFn: () => fetchAdminDashboardTemplate(templateId ?? ""),
    enabled: Boolean(templateId),
  });

  // Reseeded whenever the stored row changes — a publish, an archive or a
  // fresh draft all return a (possibly different) row, and the form must
  // track whichever one is now on screen.
  useEffect(() => {
    if (templateQ.data) {
      setRows(templateQ.data.content.widgets as SectionTemplateWidgetInput[]);
    }
  }, [templateQ.data]);

  function afterChange(next: DashboardTemplateDto): void {
    setActionError(null);
    void queryClient.invalidateQueries({ queryKey: ["admin", "dashboard-templates"] });
    void queryClient.setQueryData(["admin", "dashboard-template", templateId], next);
  }

  const onActionError = (cause: Error) => setActionError(apiErrorMessage(cause));

  const publishM = useMutation({
    mutationFn: () => publishAdminDashboardTemplate(templateId ?? ""),
    onSuccess: afterChange,
    onError: onActionError,
  });
  const archiveM = useMutation({
    mutationFn: () => archiveAdminDashboardTemplate(templateId ?? ""),
    onSuccess: afterChange,
    onError: onActionError,
  });
  const draftM = useMutation({
    mutationFn: () => createDraftFromAdminDashboardTemplate(templateId ?? ""),
    onSuccess: afterChange,
    onError: onActionError,
  });
  const deleteM = useMutation({
    mutationFn: () => deleteAdminDashboardTemplateDraft(templateId ?? ""),
    onSuccess: () => {
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "dashboard-templates"] });
    },
    onError: onActionError,
  });
  const saveM = useMutation({
    mutationFn: () =>
      updateAdminDashboardTemplate(templateId ?? "", { content: { widgets: rows } }),
    onSuccess: afterChange,
    onError: onActionError,
  });

  if (templateQ.isPending) {
    return (
      <MasterDataLayout user={user}>
        <p className="p-4 text-sm text-bms-muted">Loading template…</p>
      </MasterDataLayout>
    );
  }

  if (templateQ.isError || !templateQ.data) {
    return (
      <MasterDataLayout user={user}>
        <SectionCard title="Dashboard template">
          <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {templateQ.error ? apiErrorMessage(templateQ.error) : "This template could not be loaded."}
          </p>
          <Link
            to="/admin/dashboard-templates"
            className="mt-3 inline-block text-xs font-semibold text-bms-green hover:underline"
          >
            Back to all templates
          </Link>
        </SectionCard>
      </MasterDataLayout>
    );
  }

  const template = templateQ.data;
  const mayAuthor = canAuthorTemplates(user.role);
  const mayInstantiate = canInstantiateTemplates(user.role);
  const editable = mayAuthor && canMutate(template.status);

  // Derived from the one declared transition table — never a restated status
  // array (`tests/f3.36-template-lifecycle-single-source.test.ts`).
  const canPublish = mayAuthor && canTransition(template.status, "published");
  const canArchive = mayAuthor && canTransition(template.status, "archived");
  const canOpenDraft = mayAuthor && canOpenDraftFrom(template.status);
  const canDelete = mayAuthor && canMutate(template.status);
  // Instantiation is not a status TRANSITION and carries no shared helper —
  // ADR 0049 requires only a published version resolve against live members.
  // A single-value render comparison, not a restatement of the vocabulary.
  const canRunInstantiate = mayInstantiate && template.status === "published";

  const busy = publishM.isPending || archiveM.isPending || draftM.isPending || deleteM.isPending;

  function addWidget(): void {
    setRows((current) => [
      ...current,
      {
        key: freshWidgetKey(),
        title: null,
        gridX: 0,
        gridY: 0,
        gridW: DASHBOARD_GRID.minWidgetW,
        gridH: DASHBOARD_GRID.minWidgetH,
        bindings: [],
        sources: [],
        widgetType: "value_tile",
        config: {},
      },
    ]);
  }

  function updateWidget(key: string, patch: Partial<SectionTemplateWidgetInput>): void {
    setRows((current) =>
      current.map((row) =>
        // The cast is safe: every caller here patches identity/binding fields
        // (`title`, the four grid numbers, `bindings`) and never `widgetType`
        // or `config`. TS otherwise cannot tell that a spread of two arms of
        // the `DashboardWidgetSpec` discriminated union still matches one arm.
        row.key === key ? ({ ...row, ...patch } as SectionTemplateWidgetInput) : row,
      ),
    );
  }

  function removeWidget(key: string): void {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow={template.code}
        title={`${template.name} · v${template.version}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill label={template.status} tone={statusTone(template.status)} />
            <span>
              {template.section} · {rows.length} widget{rows.length === 1 ? "" : "s"}
            </span>
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              to="/admin/dashboard-templates"
              className="rounded border border-gray-200 px-3 py-1.5 text-xs font-semibold text-bms-muted"
            >
              All templates
            </Link>
            {editable ? (
              <button
                type="button"
                disabled={saveM.isPending}
                onClick={() => saveM.mutate()}
                className="rounded bg-bms-green px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              >
                {saveM.isPending ? "Saving…" : "Save canvas"}
              </button>
            ) : null}
            {canPublish ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => publishM.mutate()}
                className="rounded bg-bms-green px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              >
                Publish
              </button>
            ) : null}
            {canArchive ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => archiveM.mutate()}
                className="rounded bg-bms-green px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              >
                Archive
              </button>
            ) : null}
            {canOpenDraft ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => draftM.mutate()}
                className="rounded border border-gray-200 px-3 py-1.5 text-xs font-semibold text-bms-ink disabled:opacity-60"
              >
                {template.status === "archived" ? "Revive as a new draft" : "Edit this version"}
              </button>
            ) : null}
            {canDelete ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => deleteM.mutate()}
                className="rounded border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-60"
              >
                Delete draft
              </button>
            ) : null}
            {canRunInstantiate ? (
              <button
                type="button"
                onClick={() => setInstantiateOpen(true)}
                className="rounded bg-bms-green px-3 py-1.5 text-xs font-semibold text-white"
              >
                Instantiate
              </button>
            ) : null}
          </div>
        }
      />

      {actionError ? (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {actionError}
        </p>
      ) : null}

      {!editable ? (
        <p className="rounded border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
          This version is read-only. ADR 0015 freezes a template once it is published, so that
          dashboards instantiated from it never change underneath.
        </p>
      ) : null}

      <SectionCard
        title="Canvas"
        actions={
          editable ? (
            <button
              type="button"
              onClick={addWidget}
              className="rounded border border-gray-200 px-2 py-1 text-[11px] font-semibold text-bms-ink"
            >
              Add widget
            </button>
          ) : null
        }
      >
        {rows.length === 0 ? (
          <p className="text-sm text-bms-muted">This template has no widgets yet.</p>
        ) : (
          <DashboardCanvas
            tiles={rows}
            renderTile={(tile) => (
              <div className="h-full rounded border border-gray-200 bg-white p-1 text-[10px] text-bms-muted">
                {tile.title ?? tile.key}
              </div>
            )}
          />
        )}

        <div className="mt-4 space-y-3">
          {rows.map((row) => (
            <WidgetEditor
              key={row.key}
              row={row}
              editable={editable}
              onChange={(patch) => updateWidget(row.key, patch)}
              onRemove={() => removeWidget(row.key)}
            />
          ))}
        </div>
      </SectionCard>

      {instantiateOpen ? (
        <InstantiateDialog template={template} onClose={() => setInstantiateOpen(false)} />
      ) : null}
    </MasterDataLayout>
  );
}

/**
 * One widget's editing surface: title, the four grid fields (bounded by
 * `DASHBOARD_GRID`, never a bare number), and its role bindings.
 */
function WidgetEditor({
  row,
  editable,
  onChange,
  onRemove,
}: {
  row: SectionTemplateWidgetInput;
  editable: boolean;
  onChange: (patch: Partial<SectionTemplateWidgetInput>) => void;
  onRemove: () => void;
}) {
  const bindings = row.bindings ?? [];

  return (
    <section className="space-y-2 rounded border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-bms-muted">
          {row.key}
        </span>
        {editable ? (
          <button
            type="button"
            onClick={onRemove}
            className="rounded border border-red-200 px-2 py-0.5 text-[11px] font-semibold text-red-700"
          >
            Remove
          </button>
        ) : null}
      </div>

      <label className="block text-xs font-semibold text-bms-ink">
        Title
        <input
          type="text"
          disabled={!editable}
          value={row.title ?? ""}
          onChange={(event) => onChange({ title: event.target.value || null })}
          className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs font-normal disabled:bg-gray-50"
        />
      </label>

      <div className="grid grid-cols-4 gap-2">
        <label className="block text-[11px] font-semibold text-bms-ink">
          gridX
          <input
            type="number"
            disabled={!editable}
            min={0}
            max={DASHBOARD_GRID.columns - 1}
            value={row.gridX}
            onChange={(event) => onChange({ gridX: Number(event.target.value) })}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs disabled:bg-gray-50"
          />
        </label>
        <label className="block text-[11px] font-semibold text-bms-ink">
          gridY
          <input
            type="number"
            disabled={!editable}
            min={0}
            value={row.gridY}
            onChange={(event) => onChange({ gridY: Number(event.target.value) })}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs disabled:bg-gray-50"
          />
        </label>
        <label className="block text-[11px] font-semibold text-bms-ink">
          gridW
          <input
            type="number"
            disabled={!editable}
            min={DASHBOARD_GRID.minWidgetW}
            max={DASHBOARD_GRID.columns}
            value={row.gridW}
            onChange={(event) => onChange({ gridW: Number(event.target.value) })}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs disabled:bg-gray-50"
          />
        </label>
        <label className="block text-[11px] font-semibold text-bms-ink">
          gridH
          <input
            type="number"
            disabled={!editable}
            min={DASHBOARD_GRID.minWidgetH}
            max={DASHBOARD_GRID.maxWidgetH}
            value={row.gridH}
            onChange={(event) => onChange({ gridH: Number(event.target.value) })}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs disabled:bg-gray-50"
          />
        </label>
      </div>

      <div>
        <span className="text-[11px] font-semibold text-bms-ink">Bindings</span>
        <ul className="mt-1 space-y-1">
          {bindings.map((binding, index) => (
            <li
              key={`${binding.assetRoleCode}-${binding.pointKey}-${index}`}
              className="flex items-center justify-between rounded border border-gray-100 px-2 py-1 text-xs"
            >
              <span>
                {binding.assetRoleCode} · {binding.pointKey}
              </span>
              {editable ? (
                <button
                  type="button"
                  onClick={() =>
                    onChange({ bindings: bindings.filter((_, position) => position !== index) })
                  }
                  aria-label={`Remove binding ${binding.assetRoleCode} ${binding.pointKey}`}
                  className="text-red-700"
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {editable ? (
          <div className="mt-2">
            <AssetRoleBindingPicker
              onAdd={(binding) =>
                onChange({ bindings: [...bindings, { ...binding, sortOrder: bindings.length }] })
              }
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Instantiates the published template against one asset group, and shows the
 * resolution report unconditionally on success — ADR 0049 Amendment 2
 * decision 1.
 */
function InstantiateDialog({
  template,
  onClose,
}: {
  template: DashboardTemplateDto;
  onClose: () => void;
}) {
  const [assetGroupId, setAssetGroupId] = useState("");
  const [slug, setSlug] = useState("");
  const [name, setName] = useState(`${template.name} dashboard`);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InstantiateSectionTemplateResponse | null>(null);

  const groupsQ = useQuery({
    queryKey: ["admin", "asset-groups", "all"],
    queryFn: () => fetchAdminAssetGroups(),
  });
  const groups = groupsQ.data?.items ?? [];

  const instantiateM = useMutation({
    mutationFn: () =>
      instantiateAdminDashboardTemplate(template.id, {
        assetGroupId,
        slug: slug.trim(),
        name: name.trim(),
      }),
    onSuccess: (response) => {
      setError(null);
      setResult(response);
    },
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });

  const canSubmit = assetGroupId !== "" && slug.trim() !== "" && name.trim() !== "";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-2xl space-y-3 rounded-lg bg-white p-4 shadow-lg">
        <h2 className="font-condensed text-base font-bold text-bms-ink">
          Instantiate {template.code} v{template.version}
        </h2>

        {result ? (
          <ResolutionReport result={result} />
        ) : (
          <>
            <label className="block text-xs font-semibold text-bms-ink">
              Asset group
              <select
                required
                value={assetGroupId}
                onChange={(event) => setAssetGroupId(event.target.value)}
                className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs font-normal"
              >
                <option value="">Select an asset group…</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-bms-ink">
                Slug
                <input
                  required
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                  placeholder="electrical-plant-1"
                  className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs font-normal"
                />
              </label>
              <label className="block text-xs font-semibold text-bms-ink">
                Name
                <input
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs font-normal"
                />
              </label>
            </div>

            {error ? (
              <p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                {error}
              </p>
            ) : null}
          </>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-200 px-3 py-1.5 text-xs font-semibold text-bms-muted"
          >
            {result ? "Close" : "Cancel"}
          </button>
          {!result ? (
            <button
              type="button"
              // Distinct from the page header's own "Instantiate" button that
              // opens this dialog — `getByRole` cannot otherwise tell the two
              // apart.
              aria-label="Confirm instantiate"
              disabled={!canSubmit || instantiateM.isPending}
              onClick={() => {
                setError(null);
                instantiateM.mutate();
              }}
              className="rounded bg-bms-green px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              {instantiateM.isPending ? "Instantiating…" : "Instantiate"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const OUTCOME_LABELS: Record<TemplateWidgetResolutionDto["outcome"], string> = {
  bound: "Bound — every matched member is wired up",
  truncated: "Truncated — more members matched than the widget can hold",
  partial: "Partial — some matched members carry no point with this key",
  unresolved: "Unresolved — no member matched; renders \"no data bound\"",
};

/**
 * The resolution report, always shown after a successful instantiate — ADR
 * 0049 Amendment 2 decision 1. Every widget that resolved as `partial` or
 * `truncated` is named by `widgetKey`, with `matchedMembers` and
 * `boundPoints`, so an administrator can find and fix exactly the ones that
 * need it (decision 6).
 */
function ResolutionReport({ result }: { result: InstantiateSectionTemplateResponse }) {
  const needsAttention = result.resolutions.filter(
    (r) => r.outcome === "partial" || r.outcome === "truncated" || r.outcome === "unresolved",
  );

  return (
    <div className="space-y-3">
      <p className="rounded border border-green-200 bg-green-50 p-2 text-xs text-green-900">
        Created dashboard <strong>{result.dashboard.name}</strong>.
      </p>

      {needsAttention.length > 0 ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          <p className="font-semibold">
            {needsAttention.length} widget{needsAttention.length === 1 ? "" : "s"} need attention.
          </p>
        </div>
      ) : null}

      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[11px] uppercase text-bms-muted">
            <th className="py-1">Widget</th>
            <th className="py-1">Matched members</th>
            <th className="py-1">Bound points</th>
            <th className="py-1">Outcome</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {result.resolutions.map((resolution) => (
            <tr key={resolution.widgetKey}>
              <td className="py-1 font-semibold">{resolution.widgetKey}</td>
              <td className="py-1">{resolution.matchedMembers}</td>
              <td className="py-1">{resolution.boundPoints}</td>
              <td className="py-1">{OUTCOME_LABELS[resolution.outcome]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
