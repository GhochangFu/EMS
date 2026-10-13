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
 * The repository's entries from `GET stock`, each with an Import that opens
 * the `ImportStockWizard` (`F4.254` PR 2): an Organization step, then Review,
 * and only Review's Submit imports — and, unlike the dashboard page, the import
 * **lands on the new draft**, because that is where the author's next action
 * is. The organization picker that sat in the card's header is that step now.
 * Gated on `canAuthorTemplates`, as the dashboard card is: an import is an
 * authoring act (ADR 0015 §7 excludes `location_admin`), and the catalog is
 * master data the server refuses to list to anyone else anyway.
 *
 * ## New template (`F4.254` PR 2)
 *
 * The `CreateTemplateWizard`: the `assetTemplate.create` stepper on the shared
 * `WizardShell`, the modal's six inputs on one step, then Review. A wizard
 * used alone sends the plain request, never `X-Copilot-Change`.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AssetTemplateStatus } from "@bms/shared";

import { fetchAdminAssetTemplates, fetchAdminStockAssetTemplates } from "../../api/admin/asset-templates";
import { apiErrorMessage } from "../../lib/api-error-message";
import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { AssetTemplatesPageTabStrip } from "../../components/admin/asset-templates-page-tab-strip";
import { CreateTemplateWizard } from "../../components/asset-templates/create-template-wizard";
import { ImportStockWizard } from "../../components/asset-templates/import-stock-wizard";
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

/** Admin screen listing asset template versions, grouped by code. */
export function AssetTemplatesAdminPage({ user }: AssetTemplatesAdminPageProps) {
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
  // `F4.254` PR 2 — the stock entry whose Import wizard is open.
  // A refusal that arrived after its wizard was cancelled (nothing else shows it).
  const [closedError, setClosedError] = useState<string | null>(null);
  const [importing, setImporting] = useState<{ code: string; name: string } | null>(null);

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


  const stockRows = stockQ.data?.items ?? [];

  // `F2.17` — one group per domain PRESENT in the response, never one per
  // vocabulary row. `assetDomains` may still be `undefined` on the render
  // between the two queries settling; `groupStockByDomain` then falls back to
  // the bare code for both the sort key and the label.
  const stockGroups = useMemo(
    () => groupStockByDomain(stockRows, vocabQ.data?.assetDomains),
    [stockRows, vocabQ.data],
  );

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
              onClick={() => {
                setClosedError(null);
                setModalOpen(true);
              }}
              className="surface-button-primary bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent"
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

      {closedError ? (
        <p className="rounded border border-critical-line bg-critical-wash p-3 text-sm text-critical-ink-strong">
          {closedError}
        </p>
      ) : null}

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
              className="surface-field px-2 py-1 text-xs"
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
                className="surface-field px-2 py-1 text-xs"
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
                className="surface-field px-2 py-1 text-xs"
              >
                <option value="">All domains</option>
                {domainOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : null}
            <div className="surface-segment flex gap-1">
              {STATUS_FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setStatus(option.value)}
                  aria-pressed={status === option.value}
                  className={`px-2 py-1 surface-segment-item ${
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
        {!listQ.isPending && !listQ.isError && visibleGroups.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No templates match this filter.
          </p>
        ) : null}

        <div className="space-y-3">
          {visibleGroups.map((group) => (
            <div
              key={`${group.organizationId}-${group.code}`}
              className="surface-raised-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-well-deep bg-well px-3 py-2">
                <div>
                  <div className="font-condensed text-sm font-bold text-ink">
                    {group.code}
                    <span className="ml-2 font-sans text-xs font-normal text-ink-muted">
                      {group.latest.name}
                    </span>
                  </div>
                  <div className="text-[11px] text-ink-muted">
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
                <div className="text-[11px] text-ink-muted">
                  {group.versions.length} version{group.versions.length === 1 ? "" : "s"}
                </div>
              </div>
              <ul className="divide-y divide-well-deep">
                {group.versions.map((version) => (
                  <li
                    key={version.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <Link
                        to={`/admin/asset-templates/${version.id}`}
                        className="text-sm font-semibold text-accent-strong hover:underline"
                      >
                        v{version.version}
                      </Link>
                      <StatusPill label={version.status} tone={statusTone(version.status)} />
                    </div>
                    <div className="text-[11px] text-ink-muted">
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
        >
          {stockQ.isPending ? <p className="text-sm text-ink-muted">Loading the stock catalog…</p> : null}
          {stockQ.isError ? (
            <p className="rounded border border-critical-line bg-critical-wash p-3 text-sm text-critical-ink-strong">
              {apiErrorMessage(stockQ.error)}
            </p>
          ) : null}
          {!stockQ.isPending && !stockQ.isError && stockRows.length === 0 ? (
            <p className="text-sm text-ink-muted">The stock catalog is empty — nothing to import.</p>
          ) : null}
          {/* `F2.17` — the rows stay HERE and arrive at the accordion as a
              render prop. `tests/f2.14-stock-viewer-reachable.test.ts:87-94`
              reads this file as text for the `<Link to={`…stock/` literal
              below; lifting the row markup into the accordion would turn that
              guard red by design. */}
          <StockCatalogAccordion
            groups={stockGroups}
            renderEntry={(entry) => {
              return (
                <li className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <div className="text-sm font-semibold text-ink">{entry.name}</div>
                    {/* `F2.21` — the label, for the same reason the Templates
                        header uses it, and because this row would otherwise be
                        the ONE place left printing a bare code. The browser pass
                        caught it: the accordion heading directly above already
                        read "Electrical" while the row under it read
                        `· electrical ·`. Fixing the Templates side alone is what
                        made the two cards disagree, so it belongs to this row. */}
                    <div className="text-[11px] text-ink-muted">
                      {entry.code} · {labelFor(vocabQ.data?.assetDomains, entry.domain)} · stock v
                      {entry.stockVersion}
                    </div>
                    <div className="text-[11px] text-ink-muted">
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
                      className="surface-button px-3 py-1.5"
                    >
                      View
                    </Link>
                    {/* `F4.254` PR 2 — opens the Import wizard; its Organization step is the picker. */}
                    <button
                      type="button"
                      aria-label={`Import ${entry.name}`}
                      onClick={() => {
                        setClosedError(null);
                        setImporting({ code: entry.code, name: entry.name });
                      }}
                      className="surface-button px-3 py-1.5"
                    >
                      Import
                    </button>
                  </div>
                </li>
              );
            }}
          />

        </SectionCard>
      ) : null}

      {modalOpen && mayAuthor ? (
        <CreateTemplateWizard
          onClose={() => setModalOpen(false)}
          onClosedError={setClosedError}
        />
      ) : null}

      {importing !== null && mayAuthor ? (
        <ImportStockWizard
          entry={importing}
          onClose={() => setImporting(null)}
          onClosedError={setClosedError}
        />
      ) : null}
    </MasterDataLayout>
  );
}
