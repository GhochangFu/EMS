/**
 * The section dashboard template list (`F3.36` Part F, ADR 0049).
 *
 * Two panels: the organization's own templates, with a status and a section
 * filter, and the repository's stock catalog with an Import action per row
 * (ADR 0049 decision 3). Both filters run at the API, through
 * `fetchAdminDashboardTemplates`'s query parameters, exactly as
 * `asset-templates-page.tsx`'s status filter does — so the query key and the
 * rows that arrive can never disagree.
 *
 * **The section filter is fed from `GET /api/v1/vocabularies`**
 * (`dashboardSections`), never a hardcoded six — ADR 0049 Amendment 2
 * decision 5 makes the section vocabulary open precisely so a seventh section
 * is configuration rather than a release.
 *
 * **`F3.85` PR 10a (ADR 0099 decision 6, plan §11.2)** — New template and a
 * stock row's Import are steppers on the shared `WizardShell`: the catalog
 * entry's steps, then Review, and only Review's Submit sends the request. A
 * wizard used alone sends the plain request, never `X-Copilot-Change` (plan
 * §10.5): a copilot write goes through the dock's Confirm card only.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { TemplateLifecycleStatus } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import {
  type CreateDashboardTemplateInput,
  createAdminDashboardTemplate,
  fetchAdminDashboardTemplates,
  fetchAdminStockDashboardTemplates,
  importAdminStockDashboardTemplate,
} from "../../api/admin/dashboard-templates";
import { fetchAdminOrganizations } from "../../api/admin/organizations";
import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import { apiErrorMessage } from "../../lib/api-error-message";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { WizardShell } from "../../components/wizard/wizard-shell";
import { canAuthorTemplates } from "../../lib/template-authoring-access";
import { statusTone } from "../../lib/template-lifecycle";
import type { WizardStep } from "../../lib/wizard-steps";
import type { AuthUser } from "../../stores/auth-store";

type DashboardTemplatesAdminPageProps = { user: AuthUser };

type StatusFilter = TemplateLifecycleStatus | "all";

const STATUS_FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
];

/** The catalog entry a wizard submits, by its literal id (the stepper coverage gate reads the id). */
function wizardEntry(id: string): CatalogEntry {
  const found = catalogEntry(id);
  if (found === undefined) throw new Error(`No copilot catalog entry "${id}".`);
  return found;
}

/** `values` with `field` set, or removed when the input is cleared — a wizard sends no key it left unset. */
function withField(values: Record<string, unknown>, field: string, raw: string): Record<string, unknown> {
  const next = { ...values };
  if (raw === "") delete next[field];
  else next[field] = raw;
  return next;
}

function textOf(values: Record<string, unknown>, field: string): string {
  const value = values[field];
  return typeof value === "string" ? value : "";
}

/**
 * The create request from the wizard's body — the same normalization the
 * modal applied before `F3.85`: code and name trimmed, a blank description
 * sent as `null`.
 */
function createInput(body: Record<string, unknown>): CreateDashboardTemplateInput {
  const description = textOf(body, "description").trim();
  return {
    ...(body as unknown as CreateDashboardTemplateInput),
    code: textOf(body, "code").trim(),
    name: textOf(body, "name").trim(),
    description: description === "" ? null : description,
  };
}

/**
 * A `content` value's widget and tab counts, or null when it is not an object
 * with a `widgets` array — the copilot's `fill_step` can put any value there.
 */
function contentCounts(content: unknown): { widgets: number; tabs: number } | null {
  if (typeof content !== "object" || content === null) return null;
  const { widgets, tabs } = content as { widgets?: unknown; tabs?: unknown };
  if (!Array.isArray(widgets)) return null;
  return { widgets: widgets.length, tabs: Array.isArray(tabs) ? tabs.length : 0 };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

type StockImport = { code: string; name: string };

/** Admin screen listing section dashboard templates, plus the stock catalog. */
export function DashboardTemplatesAdminPage({ user }: DashboardTemplatesAdminPageProps) {
  const queryClient = useQueryClient();
  const mayAuthor = canAuthorTemplates(user.role);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [section, setSection] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [importOrgId, setImportOrgId] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState<StockImport | null>(null);
  const [importValues, setImportValues] = useState<Record<string, unknown>>({});

  const listQ = useQuery({
    queryKey: ["admin", "dashboard-templates", status, section],
    queryFn: () =>
      fetchAdminDashboardTemplates(
        status === "all" ? undefined : status,
        section === "" ? undefined : section,
      ),
  });

  const stockQ = useQuery({
    queryKey: ["admin", "dashboard-templates", "stock"],
    queryFn: fetchAdminStockDashboardTemplates,
  });

  const orgsQ = useQuery({
    queryKey: ["admin", "organizations", "true"],
    queryFn: () => fetchAdminOrganizations("true"),
    enabled: mayAuthor,
  });

  // Feeds both the section filter (always visible) and the create form's
  // section select, so it is fetched unconditionally rather than gated on
  // `modalOpen` — the filter needs the live vocabulary before the form ever
  // opens.
  const vocabQ = useQuery({
    queryKey: vocabulariesQueryKey,
    queryFn: fetchVocabularies,
  });

  const createM = useMutation({
    mutationFn: (body: Record<string, unknown>) => createAdminDashboardTemplate(createInput(body)),
    onSuccess: () => {
      setModalOpen(false);
      setForm({});
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "dashboard-templates"] });
    },
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });

  const importM = useMutation({
    mutationFn: ({ code, organizationId }: { code: string; organizationId: string }) =>
      importAdminStockDashboardTemplate(code, organizationId),
    onSuccess: () => {
      setImportError(null);
      setImporting(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "dashboard-templates"] });
    },
    onError: (cause: Error) => setImportError(apiErrorMessage(cause)),
  });

  const rows = listQ.data?.items ?? [];
  const stockRows = stockQ.data?.items ?? [];
  const orgs = orgsQ.data?.items ?? [];
  // An id that is not in the list (a copilot fill can set any) is named by itself, never hidden.
  const orgName = (id: unknown): string =>
    orgs.find((org) => org.id === id)?.name ??
    (typeof id === "string" && id !== "" ? id : "the organization");

  // A value change clears the last server error: the shell shows `submitError`
  // in place of Review's own problems and will not submit while those exist,
  // so a stale error would hide the reason Submit does nothing.
  function updateForm(next: Record<string, unknown>): void {
    setError(null);
    setForm(next);
  }

  function updateImport(next: Record<string, unknown>): void {
    setImportError(null);
    setImportValues(next);
  }

  function organizationSelect(values: Record<string, unknown>, onChange: (next: Record<string, unknown>) => void) {
    const pick = (event: { currentTarget: HTMLSelectElement }) =>
      onChange(withField(values, "organizationId", event.currentTarget.value));
    return (
      <label className="block text-xs font-semibold text-ink">
        Organization
        <select
          value={textOf(values, "organizationId")}
          onChange={pick}
          className="mt-1 w-full surface-field px-2 py-1 text-xs font-normal"
        >
          <option value="">Select an organization…</option>
          {orgs.map((org) => (
            <option key={org.id} value={org.id}>
              {org.code} — {org.name}
            </option>
          ))}
        </select>
      </label>
    );
  }

  // `target` and `content` have no input: the API defaults `target` to
  // `asset_group`, and the canvas is authored on the template's own screen.
  // A value the copilot's `fill_step` put in either is shown, so a step never
  // describes something other than what Submit sends.
  function renderCreateStep(step: WizardStep) {
    if (step.id === "content") {
      if (form.content === undefined) {
        return (
          <p className="text-[11px] text-ink-muted">
            A template is created as a draft at version 1. Widgets are authored on the next screen.
          </p>
        );
      }
      const counts = contentCounts(form.content);
      return (
        <p className="text-[11px] text-ink-muted">
          The template is created with the filled content:{" "}
          {counts === null
            ? "not a widget list."
            : `${plural(counts.widgets, "widget")}${counts.tabs > 0 ? `, ${plural(counts.tabs, "tab")}` : ""}.`}
        </p>
      );
    }
    if (step.id !== "basics") return null;
    const text = (field: string, label: string, placeholder: string) => (
      <label className="block text-xs font-semibold text-ink">
        {label}
        <input
          value={textOf(form, field)}
          onChange={(event) => updateForm(withField(form, field, event.target.value))}
          // Trimmed when the field is left, so Review shows what Submit sends (`createInput` trims too).
          onBlur={(event) => setForm(withField(form, field, event.target.value.trim()))}
          placeholder={placeholder}
          className="mt-1 w-full surface-field px-2 py-1 text-xs font-normal"
        />
      </label>
    );
    return (
      <>
        {organizationSelect(form, updateForm)}
        <div className="grid gap-3 sm:grid-cols-2">
          {text("code", "Code", "ELECTRICAL")}
          {text("name", "Name", "Electrical overview")}
          <label className="block text-xs font-semibold text-ink">
            Section
            <select
              value={textOf(form, "section")}
              onChange={(event) => updateForm(withField(form, "section", event.currentTarget.value))}
              className="mt-1 w-full surface-field px-2 py-1 text-xs font-normal"
            >
              <option value="">Select a section…</option>
              {(vocabQ.data?.dashboardSections ?? []).map((row) => (
                <option key={row.code} value={row.code}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-xs font-semibold text-ink">
          Description
          <textarea
            value={textOf(form, "description")}
            onChange={(event) => updateForm(withField(form, "description", event.target.value))}
            rows={2}
            className="mt-1 w-full surface-field px-2 py-1 text-xs font-normal"
          />
        </label>
        {form.target !== undefined ? (
          <p className="text-[11px] text-ink-muted">Target:{" "}
            {typeof form.target === "string" ? form.target : JSON.stringify(form.target)} (filled by the copilot).</p>
        ) : null}
      </>
    );
  }

  function closeCreate(): void {
    setModalOpen(false);
    setForm({});
    setError(null);
  }

  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Master Data"
        title="Dashboard Templates"
        subtitle="Author a section canvas once, then instantiate it against any asset group."
        actions={
          mayAuthor ? (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent"
            >
              New template
            </button>
          ) : null
        }
      />

      <SectionCard
        title="Templates"
        subtitle={`${rows.length} template${rows.length === 1 ? "" : "s"}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter by section"
              value={section}
              onChange={(event) => setSection(event.target.value)}
              className="surface-field px-2 py-1 text-xs"
            >
              <option value="">All sections</option>
              {(vocabQ.data?.dashboardSections ?? []).map((row) => (
                <option key={row.code} value={row.code}>
                  {row.label}
                </option>
              ))}
            </select>
            <div className="flex gap-1 surface-segment">
              {STATUS_FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setStatus(option.value)}
                  aria-pressed={status === option.value}
                  className={`surface-segment-item px-2 py-1 ${
                    status === option.value ? "surface-segment-item-selected" : ""
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        }
      >
        {listQ.isPending ? <p className="text-sm text-ink-muted">Loading templates…</p> : null}
        {listQ.isError ? (
          <p className="rounded border border-critical-line bg-critical-wash p-3 text-sm text-critical-ink-strong">
            {apiErrorMessage(listQ.error)}
          </p>
        ) : null}
        {!listQ.isPending && !listQ.isError && rows.length === 0 ? (
          <p className="text-sm text-ink-muted">No templates match this filter.</p>
        ) : null}

        <ul className="divide-y divide-well-deep">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <Link
                  to={`/admin/dashboard-templates/${row.id}`}
                  className="text-sm font-semibold text-accent-strong hover:underline"
                >
                  {row.code} v{row.version}
                </Link>
                {row.target === "site" ? (
                  <span className="ml-2 rounded border border-info-line bg-info-wash px-1.5 py-0.5 text-[10px] font-semibold uppercase text-info-ink">
                    Site
                  </span>
                ) : null}
                <div className="text-[11px] text-ink-muted">
                  {row.name} · {row.section} · {row.widgetCount} widget
                  {row.widgetCount === 1 ? "" : "s"}
                </div>
              </div>
              <StatusPill label={row.status} tone={statusTone(row.status)} />
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard
        title="Stock catalog"
        // The count is derived, and only on success: while the stock query is
        // pending or errored `stockRows` is `[]`, and "0 repository defaults"
        // would be a confident false statement over an empty list.
        subtitle={
          stockQ.isSuccess
            ? `${stockRows.length} repository default${
                stockRows.length === 1 ? "" : "s"
              } (ADR 0049 decision 3)`
            : "Repository defaults (ADR 0049 decision 3)"
        }
        actions={
          mayAuthor ? (
            <select
              aria-label="Import into organization"
              value={importOrgId}
              onChange={(event) => setImportOrgId(event.target.value)}
              className="surface-field px-2 py-1 text-xs"
            >
              <option value="">Select an organization…</option>
              {(orgsQ.data?.items ?? []).map((org) => (
                <option key={org.id} value={org.id}>
                  {org.code} — {org.name}
                </option>
              ))}
            </select>
          ) : null
        }
      >
        {stockQ.isPending ? <p className="text-sm text-ink-muted">Loading the stock catalog…</p> : null}
        {stockQ.isError ? (
          <p className="rounded border border-critical-line bg-critical-wash p-3 text-sm text-critical-ink-strong">
            {apiErrorMessage(stockQ.error)}
          </p>
        ) : null}
        {importError ? (
          <p className="mb-2 rounded border border-critical-line bg-critical-wash p-2 text-xs text-critical-ink-strong">
            {importError}
          </p>
        ) : null}
        <ul className="divide-y divide-well-deep">
          {stockRows.map((entry) => {
            const importingThis = importM.isPending && importM.variables?.code === entry.code;
            return (
              <li key={entry.code} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <div className="text-sm font-semibold text-ink">{entry.name}</div>
                  <div className="text-[11px] text-ink-muted">
                    {entry.code} · {entry.section} · stock v{entry.stockVersion}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    to={`/admin/dashboard-templates/stock/${entry.code}`}
                    aria-label={`View ${entry.name}`}
                    className="surface-button px-3 py-1.5 hover:underline"
                  >
                    View
                  </Link>
                  {mayAuthor ? (
                    <button
                      type="button"
                      aria-label={importingThis ? `Importing ${entry.name}…` : `Import ${entry.name}`}
                      disabled={importOrgId === "" || importM.isPending}
                      aria-busy={importingThis}
                      onClick={() => {
                        setImportError(null);
                        setImportValues({ organizationId: importOrgId });
                        setImporting({ code: entry.code, name: entry.name });
                      }}
                      className="surface-button px-3 py-1.5 disabled:opacity-60"
                    >
                      {importingThis ? "Importing…" : "Import"}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </SectionCard>

      {modalOpen && mayAuthor ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-scrim/30 p-4">
          <div className="w-full max-w-lg space-y-3 surface-dialog p-4">
            <h2 className="font-condensed text-base font-bold text-ink">New template</h2>
            <WizardShell
              entry={wizardEntry("dashboardTemplate.create")}
              values={form}
              onChange={updateForm}
              renderStep={renderCreateStep}
              onSubmit={(body) => {
                setError(null);
                createM.mutate(body);
              }}
              onCancel={closeCreate}
              submitting={createM.isPending}
              submitError={error}
              summary={wizardEntry("dashboardTemplate.create").summary({
                body: form,
                params: {},
                targetName: orgName(form.organizationId),
                organizationName: orgName(form.organizationId),
              })}
            />
          </div>
        </div>
      ) : null}

      {importing !== null && mayAuthor ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-scrim/30 p-4">
          <div className="w-full max-w-lg space-y-3 surface-dialog p-4">
            <h2 className="font-condensed text-base font-bold text-ink">Import {importing.name}</h2>
            <WizardShell
              entry={wizardEntry("dashboardTemplate.importStock")}
              values={importValues}
              onChange={updateImport}
              renderStep={(step) =>
                step.id === "organization" ? organizationSelect(importValues, updateImport) : null
              }
              onSubmit={(body) => {
                setImportError(null);
                importM.mutate({ code: importing.code, organizationId: textOf(body, "organizationId") });
              }}
              onCancel={() => {
                setImporting(null);
                setImportError(null);
              }}
              submitting={importM.isPending}
              submitError={importError}
              summary={wizardEntry("dashboardTemplate.importStock").summary({
                body: importValues,
                params: { code: importing.code },
                targetName: orgName(importValues.organizationId),
                organizationName: orgName(importValues.organizationId),
              })}
            />
          </div>
        </div>
      ) : null}
    </MasterDataLayout>
  );
}
