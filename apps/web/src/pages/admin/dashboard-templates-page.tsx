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
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import type { TemplateLifecycleStatus } from "@bms/shared";

import {
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
import { canAuthorTemplates } from "../../lib/template-authoring-access";
import { statusTone } from "../../lib/template-lifecycle";
import type { AuthUser } from "../../stores/auth-store";

type DashboardTemplatesAdminPageProps = { user: AuthUser };

type StatusFilter = TemplateLifecycleStatus | "all";

const STATUS_FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
];

const emptyForm = {
  organizationId: "",
  code: "",
  name: "",
  section: "",
  description: "",
};

/** Admin screen listing section dashboard templates, plus the stock catalog. */
export function DashboardTemplatesAdminPage({ user }: DashboardTemplatesAdminPageProps) {
  const queryClient = useQueryClient();
  const mayAuthor = canAuthorTemplates(user.role);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [section, setSection] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [importOrgId, setImportOrgId] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

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
    mutationFn: () =>
      createAdminDashboardTemplate({
        organizationId: form.organizationId,
        code: form.code.trim(),
        name: form.name.trim(),
        section: form.section,
        description: form.description.trim() === "" ? null : form.description.trim(),
      }),
    onSuccess: () => {
      setModalOpen(false);
      setForm(emptyForm);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "dashboard-templates"] });
    },
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });

  const importM = useMutation({
    mutationFn: (code: string) => importAdminStockDashboardTemplate(code, importOrgId),
    onSuccess: () => {
      setImportError(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "dashboard-templates"] });
    },
    onError: (cause: Error) => setImportError(apiErrorMessage(cause)),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    createM.mutate();
  }

  const rows = listQ.data?.items ?? [];
  const stockRows = stockQ.data?.items ?? [];

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
              className="rounded bg-bms-green px-3 py-1.5 text-xs font-semibold text-white"
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
              className="rounded border border-gray-200 px-2 py-1 text-xs"
            >
              <option value="">All sections</option>
              {(vocabQ.data?.dashboardSections ?? []).map((row) => (
                <option key={row.code} value={row.code}>
                  {row.label}
                </option>
              ))}
            </select>
            <div className="flex gap-1">
              {STATUS_FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setStatus(option.value)}
                  aria-pressed={status === option.value}
                  className={`rounded px-2 py-1 text-[11px] font-semibold ${
                    status === option.value
                      ? "bg-bms-green text-white"
                      : "bg-gray-100 text-bms-muted hover:text-bms-ink"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        }
      >
        {listQ.isPending ? <p className="text-sm text-bms-muted">Loading templates…</p> : null}
        {listQ.isError ? (
          <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {(listQ.error as Error).message}
          </p>
        ) : null}
        {!listQ.isPending && !listQ.isError && rows.length === 0 ? (
          <p className="text-sm text-bms-muted">No templates match this filter.</p>
        ) : null}

        <ul className="divide-y divide-gray-100">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <Link
                  to={`/admin/dashboard-templates/${row.id}`}
                  className="text-sm font-semibold text-bms-green hover:underline"
                >
                  {row.code} v{row.version}
                </Link>
                <div className="text-[11px] text-bms-muted">
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
        subtitle="The six repository defaults (ADR 0049 decision 3)"
        actions={
          mayAuthor ? (
            <select
              aria-label="Import into organization"
              value={importOrgId}
              onChange={(event) => setImportOrgId(event.target.value)}
              className="rounded border border-gray-200 px-2 py-1 text-xs"
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
        {importError ? (
          <p className="mb-2 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
            {importError}
          </p>
        ) : null}
        <ul className="divide-y divide-gray-100">
          {stockRows.map((entry) => (
            <li key={entry.code} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <div className="text-sm font-semibold text-bms-ink">{entry.name}</div>
                <div className="text-[11px] text-bms-muted">
                  {entry.code} · {entry.section} · stock v{entry.stockVersion}
                </div>
              </div>
              {mayAuthor ? (
                <button
                  type="button"
                  aria-label={`Import ${entry.name}`}
                  disabled={importOrgId === "" || importM.isPending}
                  onClick={() => {
                    setImportError(null);
                    importM.mutate(entry.code);
                  }}
                  className="rounded border border-gray-200 px-3 py-1.5 text-xs font-semibold text-bms-ink disabled:opacity-60"
                >
                  Import
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </SectionCard>

      {modalOpen && mayAuthor ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
          <form
            onSubmit={submit}
            className="w-full max-w-lg space-y-3 rounded-lg bg-white p-4 shadow-lg"
          >
            <h2 className="font-condensed text-base font-bold text-bms-ink">New template</h2>
            <p className="text-[11px] text-bms-muted">
              A template is created as a draft at version 1. Widgets are authored on the next
              screen.
            </p>

            <label className="block text-xs font-semibold text-bms-ink">
              Organization
              <select
                required
                value={form.organizationId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, organizationId: event.target.value }))
                }
                className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs font-normal"
              >
                <option value="">Select an organization…</option>
                {(orgsQ.data?.items ?? []).map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.code} — {org.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-bms-ink">
                Code
                <input
                  required
                  value={form.code}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, code: event.target.value }))
                  }
                  placeholder="ELECTRICAL"
                  className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs font-normal"
                />
              </label>
              <label className="block text-xs font-semibold text-bms-ink">
                Name
                <input
                  required
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Electrical overview"
                  className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs font-normal"
                />
              </label>
              <label className="block text-xs font-semibold text-bms-ink">
                Section
                <select
                  required
                  value={form.section}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, section: event.target.value }))
                  }
                  className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs font-normal"
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

            <label className="block text-xs font-semibold text-bms-ink">
              Description
              <textarea
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({ ...current, description: event.target.value }))
                }
                rows={2}
                className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs font-normal"
              />
            </label>

            {error ? (
              <p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  setError(null);
                }}
                className="rounded border border-gray-200 px-3 py-1.5 text-xs font-semibold text-bms-muted"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createM.isPending}
                className="rounded bg-bms-green px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              >
                {createM.isPending ? "Creating…" : "Create draft"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </MasterDataLayout>
  );
}
