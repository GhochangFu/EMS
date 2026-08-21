/**
 * The template list (`F2.5`, ADR 0038 decisions 1 and 10 — Unit 7).
 *
 * ADR 0015 makes a row a *version*, so `GET /admin/asset-templates` returns
 * `CHILLER v1`, `v2` and `v3` as three rows. This page groups them under their
 * code, which is the whole reason it is not a plain table: three unrelated-
 * looking rows give an author no way to see which version is current.
 *
 * ## Where filtering happens
 *
 * **Status filters at the API**, through the existing `status` query parameter
 * that ADR 0038 decision 1 names, and it is part of the query key so a change
 * refetches. `groupTemplateVersions` therefore takes its default — the rows
 * that arrive are already the rows to show. Filtering in both places would let
 * the query key and the group filter disagree, and the two would drift apart
 * the first time either was edited alone.
 *
 * The free-text search is different: it is client-side, so it runs over the
 * flat rows **before** grouping, for the reason `template-list-grouping.ts`
 * records — a group whose every version is filtered out must disappear rather
 * than render a header that reads "this template has no versions".
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import type { AssetTemplateStatus } from "@bms/shared";

import {
  createAdminAssetTemplate,
  fetchAdminAssetTemplates,
} from "../../api/admin/asset-templates";
import { fetchAdminOrganizations } from "../../api/admin/organizations";
import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { canAuthorTemplates } from "../../lib/template-authoring-access";
import { statusTone } from "../../lib/template-lifecycle";
import { groupTemplateVersions } from "../../lib/template-list-grouping";
import type { AuthUser } from "../../stores/auth-store";

type AssetTemplatesAdminPageProps = { user: AuthUser };

type StatusFilter = AssetTemplateStatus | "all";

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
  assetType: "",
  domain: "",
  description: "",
};

/** Admin screen listing asset template versions, grouped by code. */
export function AssetTemplatesAdminPage({ user }: AssetTemplatesAdminPageProps) {
  const queryClient = useQueryClient();
  const mayAuthor = canAuthorTemplates(user.role);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["admin", "asset-templates", status],
    queryFn: () => fetchAdminAssetTemplates(status === "all" ? undefined : status),
  });

  // Both only feed the create form, so neither is fetched until it opens.
  const orgsQ = useQuery({
    queryKey: ["admin", "organizations", "true"],
    queryFn: () => fetchAdminOrganizations("true"),
    enabled: modalOpen && mayAuthor,
  });
  // ADR 0031 Amendment 1 made `domain` a vocabulary row rather than an enum.
  // `vocabulariesQueryKey` is shared on purpose — this must not become a fourth
  // fetch of the same nine-row payload.
  const vocabQ = useQuery({
    queryKey: vocabulariesQueryKey,
    queryFn: fetchVocabularies,
    enabled: modalOpen && mayAuthor,
  });

  const groups = useMemo(() => {
    const rows = listQ.data?.items ?? [];
    const term = search.trim().toLowerCase();
    const matching = term
      ? rows.filter(
          (row) =>
            row.code.toLowerCase().includes(term) ||
            row.name.toLowerCase().includes(term) ||
            row.assetType.toLowerCase().includes(term),
        )
      : rows;
    return groupTemplateVersions(matching);
  }, [listQ.data, search]);

  const createM = useMutation({
    mutationFn: () =>
      createAdminAssetTemplate({
        organizationId: form.organizationId,
        code: form.code.trim(),
        name: form.name.trim(),
        assetType: form.assetType.trim(),
        domain: form.domain,
        description: form.description.trim() === "" ? null : form.description.trim(),
      }),
    onSuccess: () => {
      setModalOpen(false);
      setForm(emptyForm);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "asset-templates"] });
    },
    // `adminFetch` throws the raw response body. ADR 0038 decision 10's
    // residual case — right role, wrong organization — arrives here as
    // "Organization is outside your access scope", and that message is the
    // whole answer. Replacing it with "Could not create template" would hide it.
    onError: (cause: Error) => setError(cause.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    createM.mutate();
  }

  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Master Data"
        title="Asset Templates"
        subtitle="Model an asset class once, then deploy it to many sites."
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
        subtitle={`${groups.length} template${groups.length === 1 ? "" : "s"}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search code, name or asset type"
              aria-label="Search templates"
              className="rounded border border-gray-200 px-2 py-1 text-xs"
            />
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
        {!listQ.isPending && !listQ.isError && groups.length === 0 ? (
          <p className="text-sm text-bms-muted">
            No templates match this filter.
          </p>
        ) : null}

        <div className="space-y-3">
          {groups.map((group) => (
            <div
              key={`${group.organizationId}-${group.code}`}
              className="rounded border border-gray-200"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2">
                <div>
                  <div className="font-condensed text-sm font-bold text-bms-ink">
                    {group.code}
                    <span className="ml-2 font-sans text-xs font-normal text-bms-muted">
                      {group.latest.name}
                    </span>
                  </div>
                  <div className="text-[11px] text-bms-muted">
                    {group.organizationCode} · {group.latest.assetType} · {group.latest.domain}
                  </div>
                </div>
                <div className="text-[11px] text-bms-muted">
                  {group.versions.length} version{group.versions.length === 1 ? "" : "s"}
                </div>
              </div>
              <ul className="divide-y divide-gray-100">
                {group.versions.map((version) => (
                  <li
                    key={version.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <Link
                        to={`/admin/asset-templates/${version.id}`}
                        className="text-sm font-semibold text-bms-green hover:underline"
                      >
                        v{version.version}
                      </Link>
                      <StatusPill label={version.status} tone={statusTone(version.status)} />
                    </div>
                    <div className="text-[11px] text-bms-muted">
                      {version.pointCount} point{version.pointCount === 1 ? "" : "s"}
                      {version.publishedAt
                        ? ` · published ${version.publishedAt.slice(0, 10)}`
                        : ""}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </SectionCard>

      {modalOpen && mayAuthor ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
          <form
            onSubmit={submit}
            className="w-full max-w-lg space-y-3 rounded-lg bg-white p-4 shadow-lg"
          >
            <h2 className="font-condensed text-base font-bold text-bms-ink">New template</h2>
            <p className="text-[11px] text-bms-muted">
              A template is created as a draft at version 1. Points, calculations, KPIs and
              alarms are added on the next screen.
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
                  placeholder="CHILLER"
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
                  placeholder="Water-cooled chiller"
                  className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs font-normal"
                />
              </label>
              <label className="block text-xs font-semibold text-bms-ink">
                Asset type
                <input
                  required
                  value={form.assetType}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, assetType: event.target.value }))
                  }
                  placeholder="chiller"
                  className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs font-normal"
                />
              </label>
              <label className="block text-xs font-semibold text-bms-ink">
                Domain
                <select
                  required
                  value={form.domain}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, domain: event.target.value }))
                  }
                  className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs font-normal"
                >
                  <option value="">Select a domain…</option>
                  {(vocabQ.data?.assetDomains ?? []).map((domain) => (
                    <option key={domain.code} value={domain.code}>
                      {domain.label}
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
