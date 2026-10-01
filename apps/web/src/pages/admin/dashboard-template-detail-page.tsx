/**
 * The section dashboard template detail screen (`F3.36` Part F, ADR 0049).
 *
 * The canvas, from `dashboard-canvas.tsx` (`F3.1d`) — the same grid the live
 * dashboard builder renders through, because a template widget draws through
 * exactly the same renderer components; only the *binding* differs (ADR 0049
 * decision 4). Widgets bind an asset-group role plus a point key, through
 * `AssetRoleBindingPicker`, or a metric-catalog entry through
 * `MetricSourcePicker` (`F3.61`) — never a live point id, and never both kinds.
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
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  DASHBOARD_GRID,
  canMutate,
  canOpenDraftFrom,
  canTransition,
} from "@bms/shared";
import type {
  DashboardTemplateDto,
  InstantiateSectionTemplateResponse,
  SiteLayoutResultDto,
  SiteLayoutSkipReason,
  TemplateWidgetResolutionDto,
} from "@bms/shared";

import {
  applySiteTemplate,
  archiveAdminDashboardTemplate,
  createDraftFromAdminDashboardTemplate,
  deleteAdminDashboardTemplateDraft,
  fetchAdminDashboardTemplate,
  instantiateAdminDashboardTemplate,
  instantiateSiteTemplate,
  publishAdminDashboardTemplate,
  updateAdminDashboardTemplate,
} from "../../api/admin/dashboard-templates";
import type {
  SectionTemplateWidgetInput,
} from "../../api/admin/dashboard-templates";
import { fetchAdminAssetGroups } from "../../api/admin/asset-groups";
import { fetchAdminLocations } from "../../api/admin/locations";
import { DashboardCanvas } from "../../components/dashboards/dashboard-canvas";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import {
  WidgetEditor,
  renderTemplateTile,
} from "../../components/dashboard-templates/widget-editor";
import { apiErrorMessage } from "../../lib/api-error-message";
import {
  DASHBOARD_SLUG_HINT,
  DASHBOARD_SLUG_MAX,
  DASHBOARD_SLUG_MIN,
  DASHBOARD_SLUG_PATTERN,
  isDashboardSlug,
} from "../../lib/dashboard-slug";
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<SectionTemplateWidgetInput[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [instantiateOpen, setInstantiateOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

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
      // `F3.62` — leave the deleted row's page. Without this the SPA stayed on
      // `/admin/dashboard-templates/<id>` with the deleted draft still in the
      // header from the cached row, and the next lifecycle click answered 404.
      // The twin authoring page (`asset-template-detail-page.tsx`) has done
      // this in the same handler since `F3.36`.
      navigate("/admin/dashboard-templates");
    },
    onError: onActionError,
  });
  const saveM = useMutation({
    // `F3.73` — the stored tabs go back unchanged. This canvas edits the top-level widgets
    // only, and a site template's content without `tabs` is refused rather than cleared.
    mutationFn: () =>
      updateAdminDashboardTemplate(templateId ?? "", {
        content: { widgets: rows, tabs: templateQ.data?.content.tabs },
      }),
    onSuccess: afterChange,
    onError: onActionError,
  });

  if (templateQ.isPending) {
    return (
      <MasterDataLayout user={user}>
        <p className="p-4 text-sm text-ink-muted">Loading template…</p>
      </MasterDataLayout>
    );
  }

  if (templateQ.isError || !templateQ.data) {
    return (
      <MasterDataLayout user={user}>
        <SectionCard title="Dashboard template">
          <p className="rounded border border-critical-line bg-critical-wash p-3 text-sm text-critical-ink-strong">
            {templateQ.error ? apiErrorMessage(templateQ.error) : "This template could not be loaded."}
          </p>
          <Link
            to="/admin/dashboard-templates"
            className="mt-3 inline-block text-xs font-semibold text-accent-strong hover:underline"
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
  // `F3.73` — the site arm asks authorship on the API (`instantiateSite`'s `assertCanAuthor`), so a
  // `location_admin` is not offered a button that answers 403. The bulk action is the same gate.
  const isSiteTemplate = template.target === "site";
  const canRunInstantiate =
    mayInstantiate && template.status === "published" && (!isSiteTemplate || mayAuthor);
  const canApplyToSites = mayAuthor && template.status === "published" && isSiteTemplate;

  // `F3.73` — a site template holds every widget in a tab, so the top-level rows alone read "0".
  const tabs = template.content.tabs;
  const widgetCount = rows.length + tabs.reduce((sum, tab) => sum + tab.widgets.length, 0);

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
        // (`title`, the four grid numbers, `bindings`, `sources`) and never
        // `widgetType` or `config`. TS otherwise cannot tell that a spread of two arms of
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
              {template.section} · {widgetCount} widget{widgetCount === 1 ? "" : "s"}
            </span>
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              to="/admin/dashboard-templates"
              className="surface-button px-3 py-1.5"
            >
              All templates
            </Link>
            {editable ? (
              <button
                type="button"
                disabled={saveM.isPending}
                aria-busy={saveM.isPending}
                onClick={() => saveM.mutate()}
                className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent disabled:opacity-60"
              >
                {saveM.isPending ? "Saving…" : "Save canvas"}
              </button>
            ) : null}
            {canPublish ? (
              <button
                type="button"
                disabled={busy}
                aria-busy={publishM.isPending}
                onClick={() => publishM.mutate()}
                className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent disabled:opacity-60"
              >
                {publishM.isPending ? "Publishing…" : "Publish"}
              </button>
            ) : null}
            {canArchive ? (
              <button
                type="button"
                disabled={busy}
                aria-busy={archiveM.isPending}
                onClick={() => setArchiveOpen(true)}
                className="rounded border border-critical-line px-3 py-1.5 text-xs font-semibold text-critical-ink disabled:opacity-60"
              >
                {archiveM.isPending ? "Archiving…" : "Archive"}
              </button>
            ) : null}
            {canOpenDraft ? (
              <button
                type="button"
                disabled={busy}
                aria-busy={draftM.isPending}
                onClick={() => draftM.mutate()}
                className="surface-button px-3 py-1.5 disabled:opacity-60"
              >
                {draftM.isPending
                  ? template.status === "archived"
                    ? "Reviving…"
                    : "Creating draft…"
                  : template.status === "archived"
                    ? "Revive as a new draft"
                    : "Edit this version"}
              </button>
            ) : null}
            {canDelete ? (
              <button
                type="button"
                disabled={busy}
                aria-busy={deleteM.isPending}
                onClick={() => deleteM.mutate()}
                className="rounded border border-critical-line px-3 py-1.5 text-xs font-semibold text-critical-ink disabled:opacity-60"
              >
                {deleteM.isPending ? "Deleting draft…" : "Delete draft"}
              </button>
            ) : null}
            {canApplyToSites ? (
              <button
                type="button"
                onClick={() => setApplyOpen(true)}
                className="surface-button px-3 py-1.5"
              >
                Apply to all sites
              </button>
            ) : null}
            {canRunInstantiate ? (
              <button
                type="button"
                onClick={() => setInstantiateOpen(true)}
                className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent"
              >
                Instantiate
              </button>
            ) : null}
          </div>
        }
      />

      {actionError ? (
        <p className="rounded border border-critical-line bg-critical-wash p-3 text-sm text-critical-ink-strong">
          {actionError}
        </p>
      ) : null}

      {!editable ? (
        <p className="max-w-prose rounded border border-info-line bg-info-wash p-3 text-xs text-info-ink">
          This version is read-only. A template is frozen once it is published, so that dashboards
          made from it never change underneath. To change it, open a new draft.
        </p>
      ) : null}

      <SectionCard
        title="Canvas"
        actions={
          editable ? (
            <button
              type="button"
              onClick={addWidget}
              className="surface-button px-2 py-1"
            >
              Add widget
            </button>
          ) : null
        }
      >
        {isSiteTemplate && tabs.length > 0 ? (
          <ul aria-label="Site tabs" className="mb-3 divide-y divide-well-deep text-xs">
            {tabs.map((tab) => (
              <li key={tab.key} className="flex flex-wrap items-center gap-x-3 py-1.5">
                <span className="font-semibold text-ink">{tab.label}</span>
                <span className="text-ink-muted">{tab.domain ?? "overview"}</span>
                <span className="text-ink-muted">
                  {tab.widgets.length} widget{tab.widgets.length === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {rows.length === 0 ? (
          isSiteTemplate && tabs.length > 0 ? null : (
            <p className="text-sm text-ink-muted">This template has no widgets yet.</p>
          )
        ) : (
          <DashboardCanvas tiles={rows} renderTile={renderTemplateTile} />
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
        isSiteTemplate ? (
          <SiteInstantiateDialog template={template} onClose={() => setInstantiateOpen(false)} />
        ) : (
          <InstantiateDialog template={template} onClose={() => setInstantiateOpen(false)} />
        )
      ) : null}
      {applyOpen ? (
        <ApplyToSitesDialog template={template} onClose={() => setApplyOpen(false)} />
      ) : null}
      {archiveOpen ? (
        <ArchiveConfirmDialog
          template={template}
          onConfirm={() => {
            setArchiveOpen(false);
            archiveM.mutate();
          }}
          onClose={() => setArchiveOpen(false)}
        />
      ) : null}
    </MasterDataLayout>
  );
}

/**
 * `F3.73` critique — Archive asks first. It sits beside Instantiate and takes the template out of
 * use, so one stray click must not do it. Same shape as the Apply-to-all-sites confirm.
 *
 * It takes no pending flag: the confirm closes the dialog in the same click that starts the
 * post, and the page's Archive button (disabled while any lifecycle call pends, so the dialog
 * cannot reopen) is the one that announces "Archiving…" with `aria-busy`.
 */
function ArchiveConfirmDialog({
  template,
  onConfirm,
  onClose,
}: {
  template: DashboardTemplateDto;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-scrim/30 p-4">
      <div className="w-full max-w-2xl space-y-3 surface-dialog p-4">
        <h2 className="font-condensed text-base font-bold text-ink">
          Archive {template.code} v{template.version}
        </h2>
        <p className="max-w-prose text-xs text-ink-muted">
          An archived version can no longer be instantiated. Dashboards already made from it are not
          changed. You can revive it later as a new draft.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="surface-button px-3 py-1.5">
            Cancel
          </button>
          <button
            type="button"
            aria-label="Confirm archive"
            onClick={onConfirm}
            className="rounded border border-critical-line px-3 py-1.5 text-xs font-semibold text-critical-ink"
          >
            Archive
          </button>
        </div>
      </div>
    </div>
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
        assetGroupId: assetGroupId === ORGANIZATION_WIDE ? null : assetGroupId,
        slug: slug.trim(),
        name: name.trim(),
      }),
    onSuccess: (response) => {
      setError(null);
      setResult(response);
    },
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });

  /**
   * **`E4.2`, ADR 0072 decision 1 — the organization-wide option, offered only
   * when the template binds no role.**
   *
   * A binding resolves against the target asset group's members (ADR 0049
   * decision 4), so a template that binds one cannot instantiate without a group
   * and the API refuses it with a 400. Offering the option anyway would put a
   * choice in front of an administrator that is always an error — and the 400
   * arrives after the slug and the name have been typed.
   *
   * Read from `template.content`, which the detail response already carries, so
   * this costs no second fetch.
   */
  const bindsARole = template.content.widgets.some((widget) => widget.bindings.length > 0);
  /** The sentinel the select uses for "no group". `""` is already taken by the
   * "select one…" placeholder, which must stay unsubmittable. */
  const ORGANIZATION_WIDE = "__organization_wide__";

  // `E4.2` PR 2 sweep — the slug rule, not just non-emptiness. PR 2 tightened
  // `instantiateSectionTemplateBodySchema.slug` to `.min(2).max(64)` on
  // `/^[a-z0-9-]+$/`, and this gate still only asked for one character: an
  // administrator who typed "Sustainability Overview" filled the whole form and
  // got a 400 on submit. The rule is stated once in `lib/dashboard-slug.ts`.
  const canSubmit = assetGroupId !== "" && isDashboardSlug(slug.trim()) && name.trim() !== "";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-scrim/30 p-4">
      <div className="w-full max-w-2xl space-y-3 surface-dialog p-4">
        <h2 className="font-condensed text-base font-bold text-ink">
          Instantiate {template.code} v{template.version}
        </h2>

        {result ? (
          <ResolutionReport result={result} />
        ) : (
          <>
            <label className="block text-xs font-semibold text-ink">
              Asset group
              <select
                required
                value={assetGroupId}
                onChange={(event) => setAssetGroupId(event.target.value)}
                className="mt-1 w-full surface-field px-2 py-1 text-xs font-normal"
              >
                <option value="">Select an asset group…</option>
                {/* `E4.2` / ADR 0072 decision 1 — see `bindsARole` above. */}
                {bindsARole ? null : (
                  <option value={ORGANIZATION_WIDE}>Organization-wide (no group)</option>
                )}
                {/**
                 * **The location qualifier is not decoration.** This rendered
                 * `group.name` alone, and a multi-location organization names
                 * its groups by function — PHEWB has six groups all called
                 * "Electrical", one per site. The picker offered six identical
                 * options and an administrator could not tell which site they
                 * were about to instantiate into. Found by the `F3.36` browser
                 * verification, which hit the ambiguity itself and had to
                 * resolve the target by uuid.
                 *
                 * `memberCount` is shown too, because the roles a template
                 * resolves against live on the memberships: a group with no
                 * members produces an all-`unresolved` report, and seeing the
                 * count beforehand is what stops that being a surprise.
                 */}
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.locationName ? `${group.name} — ${group.locationName}` : group.name}
                    {` (${group.memberCount} member${group.memberCount === 1 ? "" : "s"})`}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              {/**
               * **The hint is a sibling of the `<label>`, never inside it.** A
               * wrapping label contributes ALL of its text to the control's
               * accessible name, so a hint inside it renames the field from
               * "Slug" to "Slug Lowercase letters, digits and hyphens…" — which
               * broke three existing `getByRole("textbox", { name: "Slug" })`
               * cases the moment it was nested. `aria-describedby` is what ties
               * it to the field instead.
               */}
              <div>
                <label className="block text-xs font-semibold text-ink">
                  Slug
                  <input
                    required
                    value={slug}
                    onChange={(event) => setSlug(event.target.value)}
                    placeholder="electrical-plant-1"
                    pattern={DASHBOARD_SLUG_PATTERN}
                    minLength={DASHBOARD_SLUG_MIN}
                    maxLength={DASHBOARD_SLUG_MAX}
                    title={DASHBOARD_SLUG_HINT}
                    aria-describedby="instantiate-slug-hint"
                    className="mt-1 w-full surface-field px-2 py-1 text-xs font-normal"
                  />
                </label>
                <span id="instantiate-slug-hint" className="mt-1 block text-[11px] text-ink-muted">
                  {DASHBOARD_SLUG_HINT}
                </span>
              </div>
              <label className="block text-xs font-semibold text-ink">
                Name
                <input
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-1 w-full surface-field px-2 py-1 text-xs font-normal"
                />
              </label>
            </div>

            {error ? (
              <p className="rounded border border-critical-line bg-critical-wash p-2 text-xs text-critical-ink-strong">
                {error}
              </p>
            ) : null}
          </>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="surface-button px-3 py-1.5"
          >
            {result ? "Close" : "Cancel"}
          </button>
          {!result ? (
            <button
              type="button"
              // Distinct from the page header's own "Instantiate" button that
              // opens this dialog — `getByRole` cannot otherwise tell the two
              // apart.
              aria-label={instantiateM.isPending ? "Instantiating…" : "Confirm instantiate"}
              disabled={!canSubmit || instantiateM.isPending}
              aria-busy={instantiateM.isPending}
              onClick={() => {
                setError(null);
                instantiateM.mutate();
              }}
              className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent disabled:opacity-60"
            >
              {instantiateM.isPending ? "Instantiating…" : "Instantiate"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The sites an organization holds, for the site arm's picker and its result's names. */
function useSiteLocations(template: DashboardTemplateDto) {
  return useQuery({
    queryKey: ["admin", "locations", "true", template.organizationId],
    queryFn: () => fetchAdminLocations("true", template.organizationId),
  });
}

/** One sentence per skip reason of the bulk action — a closed record, so a new reason fails to compile here. */
const SKIP_REASON_LABELS: Record<SiteLayoutSkipReason, string> = {
  has_view: "The site already has a site view",
  ambiguous: "A tab matches two or more asset groups — make this site's layout by hand to choose",
  no_assets: "The site has no assets to bind",
  slug_taken: "Another site already holds this dashboard slug",
};

/** What one site's copy did, in one cell: the kept tabs and any tab the site could not hold. */
function madeSummary(made: SiteLayoutResultDto): string {
  const kept = `${made.resolution.length} tab${made.resolution.length === 1 ? "" : "s"}`;
  return made.omittedTabs.length > 0
    ? `Made — ${kept}, ${made.omittedTabs.length} omitted (no matching group)`
    : `Made — ${kept}`;
}

/**
 * `F3.73` ruling Q3a — the site arm of the instantiate dialog: a published SITE template copies
 * onto one location. There is no slug and no name (the copy is named for its site), and no
 * resolution report: the answer is the one site's copy.
 */
function SiteInstantiateDialog({
  template,
  onClose,
}: {
  template: DashboardTemplateDto;
  onClose: () => void;
}) {
  const [locationId, setLocationId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SiteLayoutResultDto | null>(null);
  const locationsQ = useSiteLocations(template);

  const instantiateM = useMutation({
    mutationFn: () => instantiateSiteTemplate(template.id, locationId),
    onSuccess: (response) => {
      setError(null);
      setResult(response);
    },
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-scrim/30 p-4">
      <div className="w-full max-w-2xl space-y-3 surface-dialog p-4">
        <h2 className="font-condensed text-base font-bold text-ink">
          Instantiate {template.code} v{template.version}
        </h2>
        {result ? (
          <p className="rounded border border-accent/20 bg-ok-wash p-2 text-xs text-ok-ink">
            Created the site layout <strong>{result.dashboardSlug}</strong>. {madeSummary(result)}.
          </p>
        ) : (
          <>
            <label className="block text-xs font-semibold text-ink">
              Location
              <select
                required
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
                className="mt-1 w-full surface-field px-2 py-1 text-xs font-normal"
              >
                <option value="">Select a location…</option>
                {(locationsQ.data?.items ?? []).map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            {error ? (
              <p className="rounded border border-critical-line bg-critical-wash p-2 text-xs text-critical-ink-strong">
                {error}
              </p>
            ) : null}
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="surface-button px-3 py-1.5">
            {result ? "Close" : "Cancel"}
          </button>
          {!result ? (
            <button
              type="button"
              aria-label={instantiateM.isPending ? "Instantiating…" : "Confirm instantiate"}
              disabled={locationId === "" || instantiateM.isPending}
              aria-busy={instantiateM.isPending}
              onClick={() => {
                setError(null);
                instantiateM.mutate();
              }}
              className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent disabled:opacity-60"
            >
              {instantiateM.isPending ? "Instantiating…" : "Instantiate"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * `F3.73` ruling Q4 — "Apply to all sites": confirm, then one POST. The answer lists every site
 * the action made a copy for and every site it skipped, each skip with its reason — a skipped
 * site is a normal outcome of the action, not an error, and a report that hid it would read as
 * every site done.
 */
function ApplyToSitesDialog({
  template,
  onClose,
}: {
  template: DashboardTemplateDto;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const locationsQ = useSiteLocations(template);
  const siteName = (locationId: string): string =>
    locationsQ.data?.items.find((location) => location.id === locationId)?.name ?? locationId;

  const applyM = useMutation({
    mutationFn: () => applySiteTemplate(template.id),
    onSuccess: () => {
      setError(null);
      // The copies are the sites' views now; a cached site view read must not outlive them.
      void queryClient.invalidateQueries({ queryKey: ["control-room", "site-view"] });
    },
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });
  const result = applyM.data;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-scrim/30 p-4">
      <div className="w-full max-w-2xl space-y-3 surface-dialog p-4">
        <h2 className="font-condensed text-base font-bold text-ink">
          Apply {template.code} v{template.version} to all sites
        </h2>
        {result ? (
          <>
            <p className="rounded border border-accent/20 bg-ok-wash p-2 text-xs text-ok-ink">
              {result.made.length} site{result.made.length === 1 ? "" : "s"} made,{" "}
              {result.skipped.length} skipped.
            </p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] uppercase text-ink-muted">
                  <th className="py-1">Site</th>
                  <th className="py-1">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-well-deep">
                {result.made.map((made) => (
                  <tr key={made.locationId}>
                    <td className="py-1 font-semibold">{siteName(made.locationId)}</td>
                    <td className="py-1">{madeSummary(made)}</td>
                  </tr>
                ))}
                {result.skipped.map((skipped) => (
                  <tr key={skipped.locationId}>
                    <td className="py-1 font-semibold">{siteName(skipped.locationId)}</td>
                    <td className="py-1">Skipped — {SKIP_REASON_LABELS[skipped.reason]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <>
            <p className="max-w-prose text-xs text-ink-muted">
              This copies the template onto every active site of its organization, one site at a
              time. A site that already has a site view, has no assets, or has a tab that matches
              two or more asset groups is skipped and listed.
            </p>
            {error ? (
              <p className="rounded border border-critical-line bg-critical-wash p-2 text-xs text-critical-ink-strong">
                {error}
              </p>
            ) : null}
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="surface-button px-3 py-1.5">
            {result ? "Close" : "Cancel"}
          </button>
          {!result ? (
            <button
              type="button"
              aria-label={applyM.isPending ? "Applying…" : "Confirm apply to all sites"}
              disabled={applyM.isPending}
              aria-busy={applyM.isPending}
              onClick={() => {
                setError(null);
                applyM.mutate();
              }}
              className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent disabled:opacity-60"
            >
              {applyM.isPending ? "Applying…" : "Apply"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * **`unresolved` no longer promises a specific rendering, and that is a
 * correction.** It read *"renders 'no data bound'"*, which is true of a chart,
 * a gauge and a tank — they draw through `WidgetFrame`, whose `empty` status is
 * that exact string — and **false of a `value_tile`**, which deliberately does
 * not use `WidgetFrame` (`value-tile-widget.tsx` records the reason: `KpiTile`
 * is already the frame for that shape) and renders an em dash instead.
 *
 * An em dash is indistinguishable from "bound correctly, no telemetry yet",
 * which is the opposite of what the administrator was just told. Found by the
 * `F3.36` browser verification, on a real instantiated dashboard.
 *
 * The label now says what is true of every type — the widget has no bindings and
 * needs one — and leaves the rendering to the renderer. Making the tile show an
 * empty-binding state is a `F3.1c` change with its own review, not one to fold
 * into the row that noticed it.
 */
const OUTCOME_LABELS: Record<TemplateWidgetResolutionDto["outcome"], string> = {
  bound: "Bound — every matched member is wired up",
  truncated: "Truncated — more members matched than the widget can hold",
  partial: "Partial — some matched members carry no point with this key",
  unresolved: "Unresolved — no member matched; this widget has no bindings and needs one",
};

/**
 * The resolution report, always shown after a successful instantiate — ADR
 * 0049 Amendment 2 decision 1.
 *
 * **Two parts, and the naming happens in the second one.** The amber banner
 * carries a COUNT of the widgets needing attention; the table below it is what
 * names each widget by `widgetKey` and shows its `matchedMembers` and
 * `boundPoints`. This docblock used to credit the banner with the naming, which
 * a reader could have taken as licence to drop the table — found by the `F3.36`
 * browser verification, which read both and noticed the mismatch.
 *
 * The table is therefore not decoration: it is how decision 6's *"a page that
 * can list exactly which ones need it"* is actually satisfied.
 */
function ResolutionReport({ result }: { result: InstantiateSectionTemplateResponse }) {
  const needsAttention = result.resolutions.filter(
    (r) => r.outcome === "partial" || r.outcome === "truncated" || r.outcome === "unresolved",
  );

  return (
    <div className="space-y-3">
      <p className="rounded border border-accent/20 bg-ok-wash p-2 text-xs text-ok-ink">
        Created dashboard <strong>{result.dashboard.name}</strong>.
      </p>

      {needsAttention.length > 0 ? (
        <div className="rounded border border-warning-line bg-warning-wash p-2 text-xs text-warning-ink">
          <p className="font-semibold">
            {needsAttention.length} widget{needsAttention.length === 1 ? "" : "s"} need attention.
          </p>
        </div>
      ) : null}

      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[11px] uppercase text-ink-muted">
            <th className="py-1">Widget</th>
            <th className="py-1">Matched members</th>
            <th className="py-1">Bound points</th>
            <th className="py-1">Outcome</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-well-deep">
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
