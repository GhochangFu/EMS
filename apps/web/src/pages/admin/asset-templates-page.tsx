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
 *
 * ## The stock catalog card (`F2.13`, ADR 0052 decision 10)
 *
 * The same import control `dashboard-templates-page.tsx` has: the repository's
 * entries from `GET stock`, one organization picker, one click to import into
 * it — and, unlike the dashboard page, the click **lands on the new draft**,
 * because that is where the author's next action is. Gated on
 * `canAuthorTemplates`, as the dashboard card is: an import is an authoring
 * act (ADR 0015 §7 excludes `location_admin`), and the catalog is master data
 * the server refuses to list to anyone else anyway.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { AssetTemplateStatus } from "@bms/shared";

import {
  createAdminAssetTemplate,
  fetchAdminAssetTemplates,
  fetchAdminStockAssetTemplates,
  importAdminStockAssetTemplate,
} from "../../api/admin/asset-templates";
import { fetchAdminOrganizations } from "../../api/admin/organizations";
import { apiErrorMessage } from "../../lib/api-error-message";
import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { AssetTemplatesPageTabStrip } from "../../components/admin/asset-templates-page-tab-strip";
import { StockCatalogAccordion } from "../../components/asset-templates/stock-catalog-accordion";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import {
  resolveAssetTemplatesPageTab,
  visibleAssetTemplatesPageTabs,
  type AssetTemplatesPageTabId,
} from "../../lib/asset-templates-page-tabs";
import { canAuthorTemplates } from "../../lib/template-authoring-access";
import { groupStockByDomain } from "../../lib/stock-catalog-groups";
import {
  clampTemplateListFilters,
  filterTemplateGroups,
  templateDomainOptions,
  templateListSubtitle,
  templateOrganizationOptions,
} from "../../lib/template-list-filters";
import { statusTone } from "../../lib/template-lifecycle";
import { labelFor } from "../../lib/vocabulary";
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
  const navigate = useNavigate();
  const mayAuthor = canAuthorTemplates(user.role);

  // `F2.21` — the active list lives in the URL, not in component state, so
  // "look at the stock catalog" is a link. `resolveAssetTemplatesPageTab` also
  // holds the permission fallback: a `location_admin` following an author's
  // `?tab=stock` lands on Templates rather than on a page with no list at all,
  // because both cards below are guarded. Not a security control — the server
  // permits that role to list the catalog and the client is deliberately
  // stricter; the resolver's docblock has the whole boundary.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = resolveAssetTemplatesPageTab(searchParams.get("tab"), mayAuthor);
  const tabs = visibleAssetTemplatesPageTabs(mayAuthor);
  const selectTab = (next: AssetTemplatesPageTabId) => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    // `replace` — switching lists is not a navigation the reader wants to walk
    // back through one tab at a time.
    setSearchParams(params, { replace: true });
  };

  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [orgFilter, setOrgFilter] = useState("");
  const [domainFilter, setDomainFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [importOrgId, setImportOrgId] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["admin", "asset-templates", status],
    queryFn: () => fetchAdminAssetTemplates(status === "all" ? undefined : status),
  });

  // F2.13: the stock card is rendered for an author only, and the server
  // refuses the list to anyone else — so the fetch is gated the same way
  // rather than left to 403 for a viewer on every visit.
  const stockQ = useQuery({
    queryKey: ["admin", "asset-templates", "stock"],
    queryFn: fetchAdminStockAssetTemplates,
    enabled: mayAuthor,
  });

  // Organizations feed the create form AND the stock card's picker, so they
  // are fetched for any author rather than only once the modal opens.
  const orgsQ = useQuery({
    queryKey: ["admin", "organizations", "true"],
    queryFn: () => fetchAdminOrganizations("true"),
    enabled: mayAuthor,
  });
  // ADR 0031 Amendment 1 made `domain` a vocabulary row rather than an enum.
  // `vocabulariesQueryKey` is shared on purpose — this must not become a fourth
  // fetch of the same nine-row payload.
  //
  // `F2.17` widened `enabled` from `modalOpen && mayAuthor` to `mayAuthor`:
  // the stock catalog's group headings read their labels from `assetDomains`
  // in THIS payload, so an author needs it as soon as the card renders, not
  // only once the create modal opens. Widening the gate — rather than adding
  // a second query — is what keeps ADR 0038 decision 2 intact.
  //
  // **`F2.21` widened it again, to every role that reaches this page**, and the
  // reason is the same one a third time. The domain filter is NOT author-gated:
  // a `location_admin` reaches this page and gets the picker. With the gate at
  // `mayAuthor` they got it unlabelled — `templateDomainOptions(groups,
  // undefined)` falls back to bare codes and alphabetical order, so the control
  // read "hvac" where an author read "HVAC" and the options came back in a
  // different order for the two roles. The endpoint is `JwtAuthGuard` only, so
  // any authenticated user may read it.
  const vocabQ = useQuery({
    queryKey: vocabulariesQueryKey,
    queryFn: fetchVocabularies,
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

  // `F2.21` — the pickers are built from `groups`, i.e. from what the search
  // and status filters already left, but BEFORE the two new filters run.
  // Deriving them from `visibleGroups` instead would empty each picker as soon
  // as the other was used, so a reader could pick one organization and then
  // find every domain gone.
  const organizationOptions = useMemo(() => templateOrganizationOptions(groups), [groups]);
  const domainOptions = useMemo(
    () => templateDomainOptions(groups, vocabQ.data?.assetDomains),
    [groups, vocabQ.data],
  );
  // Clamped, then used for BOTH the `<select>` values and the filtering, so the
  // controls and the list cannot disagree. Without this, searching until the
  // selected domain has no templates leaves a `<select>` with no matching
  // `<option>` — which renders as "All domains" while the list is still
  // filtered to that domain and shows nothing.
  const filters = useMemo(
    () =>
      clampTemplateListFilters(
        { organizationId: orgFilter, domain: domainFilter },
        organizationOptions,
        domainOptions,
      ),
    [orgFilter, domainFilter, organizationOptions, domainOptions],
  );
  const visibleGroups = useMemo(
    () => filterTemplateGroups(groups, filters),
    [groups, filters],
  );

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
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });

  const importM = useMutation({
    mutationFn: (code: string) => importAdminStockAssetTemplate(code, importOrgId),
    onSuccess: (created) => {
      setImportError(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "asset-templates"] });
      // ADR 0052 decision 10 — "landing on the new draft". The draft is a new
      // row; staying here would leave the author hunting for it in the list.
      navigate(`/admin/asset-templates/${created.id}`);
    },
    onError: (cause: Error) => setImportError(apiErrorMessage(cause)),
  });

  const stockRows = stockQ.data?.items ?? [];

  // `F2.17` — one group per domain PRESENT in the response, never one per
  // vocabulary row. `assetDomains` may still be `undefined` on the render
  // between the two queries settling; `groupStockByDomain` then falls back to
  // the bare code for both the sort key and the label.
  const stockGroups = useMemo(
    () => groupStockByDomain(stockRows, vocabQ.data?.assetDomains),
    [stockRows, vocabQ.data],
  );

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

      {/* `F2.21` part 1 — the two lists are peers. They were stacked, which made
          the stock catalog's reachability a function of how long the template
          list happened to be, and that list grows without limit. */}
      <AssetTemplatesPageTabStrip
        tabs={tabs}
        active={tab}
        onSelect={selectTab}
        counts={{
          templates: listQ.data ? groups.length : undefined,
          stock: stockQ.data ? stockRows.length : undefined,
        }}
      />

      {tab === "templates" ? (
      <SectionCard
        title="Templates"
        subtitle={templateListSubtitle(visibleGroups.length, groups.length)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search code, name or asset type"
              aria-label="Search templates"
              className="rounded border border-gray-200 px-2 py-1 text-xs"
            />
            {/* `F2.21` part 2 — organization is the axis nothing addressed:
                a global admin sees every organization here, and the code was
                printed on each header but was not selectable. Both pickers are
                hidden when they would offer a single value, which is the
                location-scoped admin's case — a picker with one entry is a
                control that cannot change anything. */}
            {organizationOptions.length > 1 ? (
              <select
                value={filters.organizationId}
                onChange={(event) => setOrgFilter(event.target.value)}
                aria-label="Filter by organization"
                className="rounded border border-gray-200 px-2 py-1 text-xs"
              >
                <option value="">All organizations</option>
                {organizationOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : null}
            {domainOptions.length > 1 ? (
              <select
                value={filters.domain}
                onChange={(event) => setDomainFilter(event.target.value)}
                aria-label="Filter by domain"
                className="rounded border border-gray-200 px-2 py-1 text-xs"
              >
                <option value="">All domains</option>
                {domainOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : null}
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
        {!listQ.isPending && !listQ.isError && visibleGroups.length === 0 ? (
          <p className="text-sm text-bms-muted">
            No templates match this filter.
          </p>
        ) : null}

        <div className="space-y-3">
          {visibleGroups.map((group) => (
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
                    {/* `F2.21` — the vocabulary's label, not the bare code.
                        The header printed `hvac` while the new picker beside it
                        prints "HVAC", so filtering by "HVAC" left every row
                        reading something the filter never mentioned.
                        `labelFor` falls back to the code, which is the right
                        fallback for the render before `vocabQ` settles. */}
                    {group.organizationCode} · {group.latest.assetType} ·{" "}
                    {labelFor(vocabQ.data?.assetDomains, group.latest.domain)}
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
      ) : null}

      {/* `F2.21` — `mayAuthor` is still tested here as well as inside
          `resolveAssetTemplatesPageTab`. The resolver stops a viewer LANDING on
          this tab; this guard stops the card rendering at all, and the two
          protect different things — a permission check that lives only in a URL
          resolver would be one refactor away from being the only one. */}
      {tab === "stock" && mayAuthor ? (
        <SectionCard
          title="Stock catalog"
          subtitle="Repository class templates every organization can import (ADR 0052)"
          actions={
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
          }
        >
          {importError ? (
            <p className="mb-2 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
              {importError}
            </p>
          ) : null}
          {stockQ.isPending ? <p className="text-sm text-bms-muted">Loading the stock catalog…</p> : null}
          {stockQ.isError ? (
            <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {apiErrorMessage(stockQ.error)}
            </p>
          ) : null}
          {!stockQ.isPending && !stockQ.isError && stockRows.length === 0 ? (
            <p className="text-sm text-bms-muted">The stock catalog is empty — nothing to import.</p>
          ) : null}
          {/* `F2.17` — the rows stay HERE and arrive at the accordion as a
              render prop. `tests/f2.14-stock-viewer-reachable.test.ts:87-94`
              reads this file as text for the `<Link to={`…stock/` literal
              below; lifting the row markup into the accordion would turn that
              guard red by design. */}
          <StockCatalogAccordion
            groups={stockGroups}
            renderEntry={(entry) => (
              <li className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <div className="text-sm font-semibold text-bms-ink">{entry.name}</div>
                  <div className="text-[11px] text-bms-muted">
                    {entry.code} · {entry.domain} · stock v{entry.stockVersion}
                  </div>
                  <div className="text-[11px] text-bms-muted">
                    {entry.assetType} · {entry.points.length} point{entry.points.length === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* `F2.14` — the card is a summary, so the whole entry is
                      read on its own route. Before Import, because reading
                      comes before taking. */}
                  <Link
                    to={`/admin/asset-templates/stock/${entry.code}`}
                    aria-label={`View ${entry.name}`}
                    className="rounded border border-gray-200 px-3 py-1.5 text-xs font-semibold text-bms-muted"
                  >
                    View
                  </Link>
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
                    {importM.isPending && importM.variables === entry.code
                      ? "Importing…"
                      : "Import"}
                  </button>
                </div>
              </li>
            )}
          />

        </SectionCard>
      ) : null}

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
