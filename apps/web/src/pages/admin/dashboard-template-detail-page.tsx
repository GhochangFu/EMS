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
 * **The instantiate wizard renders the resolution report unconditionally on
 * success** (ADR 0049 Amendment 2 decision 1) — every widget's
 * `matchedMembers`, `boundPoints` and `outcome`, named by `widgetKey`. Decision
 * 6 names this dialog as where an administrator maps an unresolved widget by
 * hand: *"a page that can list exactly which ones need it"*. A report the
 * administrator never sees is the silent success the amendment exists to
 * prevent. The report is drawn here and handed to `InstantiateWizard`.
 *
 * `F3.85` PR 10b / ADR 0099 decision 6 (plan §11.2) — Publish, Archive and the
 * new draft each open their catalog entry's `WizardShell`: a bodyless entry, so
 * Review alone, whose Submit runs the same mutation the button ran (Archive's
 * card is the red `deactivate` one). Instantiate and Apply to all sites are
 * steppers in `components/dashboard-templates`. Delete draft stays a plain
 * DELETE (it is not a catalog route). No wizard sends `X-Copilot-Change`.
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
  TemplateWidgetResolutionDto,
} from "@bms/shared";

import {
  archiveAdminDashboardTemplate,
  createDraftFromAdminDashboardTemplate,
  deleteAdminDashboardTemplateDraft,
  fetchAdminDashboardTemplate,
  publishAdminDashboardTemplate,
  updateAdminDashboardTemplate,
} from "../../api/admin/dashboard-templates";
import type {
  SectionTemplateWidgetInput,
  UpdateDashboardTemplateInput,
} from "../../api/admin/dashboard-templates";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";
import { WizardShell } from "../../components/wizard/wizard-shell";
import type { WizardStep } from "../../lib/wizard-steps";
import { DashboardCanvas } from "../../components/dashboards/dashboard-canvas";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { ApplyToSitesDialog } from "../../components/dashboard-templates/apply-to-sites-dialog";
import { InstantiateWizard } from "../../components/dashboard-templates/instantiate-wizard";
import {
  WidgetEditor,
  renderTemplateTile,
} from "../../components/dashboard-templates/widget-editor";
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

/** The catalog entry a wizard submits, by its literal id (the stepper coverage gate reads the id). */
function wizardEntry(id: string): CatalogEntry {
  const found = catalogEntry(id);
  if (found === undefined) throw new Error(`No copilot catalog entry "${id}".`);
  return found;
}

/** A bodyless wizard's values (publish, archive, draft): it has no field to fill. */
const NO_VALUES: Record<string, unknown> = {};

/** The lifecycle action whose Review-only wizard is open. */
type LifecycleAction = "publish" | "archive" | "draft";

/** `values` with `field` set, or removed when the input is cleared — a wizard sends no key it left unset. */
function withField(values: Record<string, unknown>, field: string, raw: string): Record<string, unknown> {
  const next = { ...values };
  if (raw === "") delete next[field];
  else next[field] = raw;
  return next;
}

/**
 * The widget count of a `content` value — the top-level widgets plus every
 * tab's, as the header counts them — or null when it has no `widgets` array
 * (a copilot fill can put anything there).
 */
function widgetCountOf(content: unknown): number | null {
  if (typeof content !== "object" || content === null) return null;
  const { widgets, tabs } = content as { widgets?: unknown; tabs?: unknown };
  if (!Array.isArray(widgets)) return null;
  const inTabs = Array.isArray(tabs)
    ? tabs.reduce<number>((sum, tab) => {
        const tabWidgets = (tab as { widgets?: unknown } | null)?.widgets;
        return sum + (Array.isArray(tabWidgets) ? tabWidgets.length : 0);
      }, 0)
    : 0;
  return widgets.length + inTabs;
}

/**
 * The update body as sent: a name or a description trimmed, and dropped when
 * it is blank after the trim — the create path trims the same way, and the
 * route's `min(1)` would take a name of spaces.
 */
function saveBody(body: Record<string, unknown>): Record<string, unknown> {
  const next = { ...body };
  for (const field of ["name", "description"]) {
    const value = next[field];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed === "") delete next[field];
    else next[field] = trimmed;
  }
  return next;
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
  // `F3.85` PR 10b — the open lifecycle wizard; null when none is.
  const [lifecycle, setLifecycle] = useState<LifecycleAction | null>(null);
  // `F3.85` PR 10a — the open `dashboardTemplate.update` wizard's values; null when closed.
  const [saveValues, setSaveValues] = useState<Record<string, unknown> | null>(null);

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
  // A lifecycle wizard stays open while its call pends, and closes on success (10a's Save pattern).
  const afterLifecycle = (next: DashboardTemplateDto) => {
    setLifecycle(null);
    afterChange(next);
  };

  const publishM = useMutation({
    mutationFn: () => publishAdminDashboardTemplate(templateId ?? ""),
    onSuccess: afterLifecycle,
    onError: onActionError,
  });
  const archiveM = useMutation({
    mutationFn: () => archiveAdminDashboardTemplate(templateId ?? ""),
    onSuccess: afterLifecycle,
    onError: onActionError,
  });
  const draftM = useMutation({
    mutationFn: () => createDraftFromAdminDashboardTemplate(templateId ?? ""),
    onSuccess: afterLifecycle,
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
    // `F3.85` PR 10a — the body is the update wizard's (`saveValues`, seeded by Save canvas).
    mutationFn: (body: Record<string, unknown>) =>
      updateAdminDashboardTemplate(templateId ?? "", body as UpdateDashboardTemplateInput),
    onSuccess: (next: DashboardTemplateDto) => {
      setSaveValues(null);
      afterChange(next);
    },
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

  // A value change clears the last server error: the shell shows `submitError`
  // in place of Review's own problems, so a stale error would hide them.
  function updateSave(next: Record<string, unknown>): void {
    setActionError(null);
    setSaveValues(next);
  }

  // `F3.85` PR 10a — the update wizard's steps. Basics sends a name or a
  // description only when one is typed; `section` has no input (it is chosen
  // when the template is created) and is shown when the copilot fills it.
  // Content describes `values.content` — what Submit sends — never the canvas
  // alone, since a copilot fill can replace it.
  function renderSaveStep(step: WizardStep, values: Record<string, unknown>) {
    if (step.id === "content") {
      const count = widgetCountOf(values.content);
      const isCanvas =
        JSON.stringify(values.content) === JSON.stringify({ widgets: rows, tabs: template.content.tabs });
      return (
        <p className="text-[11px] text-ink-muted">
          {count === null
            ? "The content to save is not a widget list."
            : `The content to save: ${count} widget${count === 1 ? "" : "s"}.`}
          {isCanvas
            ? " It is the canvas as edited on this screen."
            : ` It is not the canvas on this screen (${widgetCount} widget${widgetCount === 1 ? "" : "s"}).`}
        </p>
      );
    }
    if (step.id !== "basics") return null;
    const text = (field: string) => (typeof values[field] === "string" ? (values[field] as string) : "");
    return (
      <>
        <label className="block text-xs font-semibold text-ink">
          Name
          <input
            value={text("name")}
            onChange={(event) => updateSave(withField(values, "name", event.target.value))}
            // Trimmed on leaving the field, so Review shows the name Submit sends.
            onBlur={() => setSaveValues(saveBody(values))}
            placeholder={template.name}
            className="mt-1 w-full surface-field px-2 py-1 text-xs font-normal"
          />
        </label>
        <label className="block text-xs font-semibold text-ink">
          Description
          <textarea
            value={text("description")}
            onChange={(event) => updateSave(withField(values, "description", event.target.value))}
            onBlur={() => setSaveValues(saveBody(values))}
            placeholder={template.description ?? ""}
            rows={2}
            className="mt-1 w-full surface-field px-2 py-1 text-xs font-normal"
          />
        </label>
        {values.section !== undefined ? (
          <p className="text-[11px] text-ink-muted">
            Section: {typeof values.section === "string" ? values.section : JSON.stringify(values.section)} (filled by
            the copilot; now {template.section}).
          </p>
        ) : null}
        <p className="text-[11px] text-ink-muted">Leave a field empty to keep it as it is.</p>
      </>
    );
  }

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

  function openLifecycle(action: LifecycleAction): void {
    setActionError(null);
    setLifecycle(action);
  }

  // The props the three Review-only lifecycle wizards share; each names its own entry.
  const lifecycleProps = (mutation: { mutate: () => void; isPending: boolean }) => ({
    values: NO_VALUES,
    onChange: () => undefined,
    renderStep: () => null,
    onSubmit: () => mutation.mutate(),
    onCancel: () => setLifecycle(null),
    submitting: mutation.isPending,
    submitError: actionError,
  });
  const summaryContext = { body: {}, params: { id: template.id }, targetName: template.name, organizationName: "" };
  const LIFECYCLE_HEADINGS: Record<LifecycleAction, string> = {
    publish: "Publish",
    archive: "Archive",
    draft: template.status === "archived" ? "Revive as a new draft:" : "New draft of",
  };

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
                // `F3.73` — the stored tabs go back unchanged. This canvas edits the top-level
                // widgets only, and a site template's content without `tabs` is refused rather
                // than cleared. `F3.85` PR 10a — Save opens the update wizard with the canvas.
                onClick={() => {
                  setActionError(null);
                  setSaveValues({ content: { widgets: rows, tabs: template.content.tabs } });
                }}
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
                onClick={() => openLifecycle("publish")}
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
                onClick={() => openLifecycle("archive")}
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
                onClick={() => openLifecycle("draft")}
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

      {/* An open wizard shows the refusal on its own card (`submitError`); the banner behind it would say it twice. */}
      {actionError && !(saveValues !== null && editable) && !(lifecycle !== null && mayAuthor) ? (
        <p className="rounded border border-critical-line bg-critical-wash p-3 text-sm text-critical-ink-strong">
          {actionError}
        </p>
      ) : null}

      {saveValues !== null && editable ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-scrim/30 p-4">
          <div className="w-full max-w-lg space-y-3 surface-dialog p-4">
            <h2 className="font-condensed text-base font-bold text-ink">Save canvas</h2>
            <WizardShell
              entry={wizardEntry("dashboardTemplate.update")}
              values={saveValues}
              onChange={updateSave}
              renderStep={(step: WizardStep) => renderSaveStep(step, saveValues)}
              onSubmit={(body) => saveM.mutate(saveBody(body))}
              onCancel={() => setSaveValues(null)}
              submitting={saveM.isPending}
              submitError={actionError}
              current={{
                name: template.name,
                section: template.section,
                description: template.description,
                content: template.content,
              }}
              summary={wizardEntry("dashboardTemplate.update").summary({
                body: saveValues,
                params: { id: template.id },
                targetName: template.name,
                organizationName: "",
              })}
            />
          </div>
        </div>
      ) : null}

      {lifecycle !== null && mayAuthor ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-scrim/30 p-4">
          <div className="w-full max-w-2xl space-y-3 surface-dialog p-4">
            <h2 className="font-condensed text-base font-bold text-ink">
              {LIFECYCLE_HEADINGS[lifecycle]} {template.code} v{template.version}
            </h2>
            {lifecycle === "publish" ? (
              <WizardShell
                entry={wizardEntry("dashboardTemplate.publish")}
                {...lifecycleProps(publishM)}
                summary={wizardEntry("dashboardTemplate.publish").summary(summaryContext)}
              />
            ) : null}
            {lifecycle === "archive" ? (
              <>
                {/* `F3.73` critique — Archive asks first: it takes the template out of use. */}
                <p className="max-w-prose text-xs text-ink-muted">
                  An archived version can no longer be instantiated. Dashboards already made from it are
                  not changed. You can revive it later as a new draft.
                </p>
                <WizardShell
                  entry={wizardEntry("dashboardTemplate.archive")}
                  {...lifecycleProps(archiveM)}
                  summary={wizardEntry("dashboardTemplate.archive").summary(summaryContext)}
                />
              </>
            ) : null}
            {lifecycle === "draft" ? (
              <WizardShell
                entry={wizardEntry("dashboardTemplate.draft")}
                {...lifecycleProps(draftM)}
                summary={wizardEntry("dashboardTemplate.draft").summary(summaryContext)}
              />
            ) : null}
          </div>
        </div>
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
        <InstantiateWizard
          template={template}
          onClose={() => setInstantiateOpen(false)}
          renderReport={(result) => <ResolutionReport result={result} />}
        />
      ) : null}
      {applyOpen ? (
        <ApplyToSitesDialog template={template} onClose={() => setApplyOpen(false)} />
      ) : null}
    </MasterDataLayout>
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
