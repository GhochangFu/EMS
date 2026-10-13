/**
 * The read-only viewer for one stock catalog entry (`F2.14`, ADR 0052
 * decisions 1 and 10).
 *
 * An administrator can read a catalog entry in full before deciding to import
 * it. The entry is rendered through the **same seven tab components the
 * authoring detail page uses**, with `editable={false}`, so there is exactly
 * one description of what a template looks like rather than a second read-only
 * copy that drifts. That is what made `F2.19` free here: `MaintenanceTab`
 * became the seventh arm of `TemplateTabBody` and this page rendered it with
 * no edit of its own. `lib/stock-template-view.ts` is the seam that makes that
 * possible: it shapes a `StockAssetTemplateDto` — the *write* shape, with no
 * row identity — as the `AdminAssetTemplateDto` the tabs take.
 *
 * **Nothing here writes to the catalog, and nothing can.** ADR 0052 decision 1
 * makes the catalog repository data; every save control in all seven tabs sits
 * behind `{editable ? … : null}`, and this page passes the literal `false`. The
 * one write on the screen is the header's Import, which opens the
 * `ImportStockWizard` (`F4.254` PR 2: the organization is its first step, and
 * only Review's Submit imports) — and Import creates a *new* row rather than
 * changing the entry.
 *
 * **No dirty guard, deliberately.** The detail page carries `guardTabSwitch`
 * and a confirmation dialog because a tab there holds unsaved edits. Nothing on
 * this page can become dirty, so a guard would prompt about work that cannot
 * exist.
 *
 * ## Why this is a route and not a panel on the list page
 *
 * A catalog reference wants to be deep-linkable and shareable, and mirroring
 * the detail page means the `?tab=` state comes free from `useSearchParams` +
 * `resolveTemplateTab`. A panel would either duplicate that state machine or
 * lose the reader's tab when it closed.
 *
 * ## `:code` is validated by the lookup, not by a regex
 *
 * `stockCodeParamSchema` lives in `apps/api/src/admin/admin.schema.ts` and
 * cannot be imported here, and a re-spelled copy would buy nothing — the code
 * is never interpolated into a request and never rendered unescaped. The entry
 * is either in the already-fetched list response or it is not, and an absent
 * one renders the not-found panel. **The load-bearing rule is the other one:
 * Import sends the resolved `entry.code`, never the raw URL parameter.**
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { AdminAssetTemplateDto } from "@bms/shared";

import { fetchAdminStockAssetTemplates } from "../../api/admin/asset-templates";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { ImportStockWizard } from "../../components/asset-templates/import-stock-wizard";
import { TemplateTabBody } from "../../components/asset-templates/template-tab-body";
import { TemplateTabStrip } from "../../components/asset-templates/template-tab-strip";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { apiErrorMessage } from "../../lib/api-error-message";
import { findStockEntry, stockEntryAsTemplate } from "../../lib/stock-template-view";
import { canAuthorTemplates } from "../../lib/template-authoring-access";
import { resolveTemplateTab, type TemplateTabId } from "../../lib/template-tabs";
import type { AuthUser } from "../../stores/auth-store";

type AssetTemplateStockViewPageProps = { user: AuthUser };

/**
 * The two callbacks the seven tabs require, as **module-level constants rather
 * than inline arrows**.
 *
 * `onDirtyChange` sits in a `useEffect` dependency array in every one of the
 * seven tabs. A fresh arrow on each render changes that dependency every time,
 * which re-runs seven effects for no reason. These are stable by construction.
 * They are not "simplifiable" back to `() => {}` at the call site.
 */
const NEVER_SAVED: (next: AdminAssetTemplateDto) => void = () => {};
const NO_DIRTY: (dirty: boolean) => void = () => {};

/** Read-only view of one stock asset-template catalog entry. */
export function AssetTemplateStockViewPage({ user }: AssetTemplateStockViewPageProps) {
  const { code } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [importOpen, setImportOpen] = useState(false);
  // A refusal that arrived after the wizard was cancelled (nothing else shows it).
  const [closedError, setClosedError] = useState<string | null>(null);

  const mayAuthor = canAuthorTemplates(user.role);
  const tab = resolveTemplateTab(searchParams.get("tab"));

  // The **same query key as the stock card** on `asset-templates-page.tsx`, so
  // arriving from the card is a cache hit and a cold deep link fetches once.
  // `enabled: mayAuthor` mirrors the card too: the server refuses this list to
  // anyone who cannot author, so an ungated fetch would 403 on every visit.
  const stockQ = useQuery({
    queryKey: ["admin", "asset-templates", "stock"],
    queryFn: fetchAdminStockAssetTemplates,
    enabled: mayAuthor,
  });

  const entry = findStockEntry(stockQ.data?.items ?? [], code ?? "");
  const view = useMemo(() => (entry ? stockEntryAsTemplate(entry) : null), [entry]);

  function openTab(next: TemplateTabId) {
    setSearchParams({ tab: next }, { replace: true });
  }

  // The role branch comes **first**, and the order is load-bearing: with
  // `enabled: mayAuthor` the query never leaves `isPending`, so checking
  // pending first would show a non-author "Loading the stock catalog…" forever.
  if (!mayAuthor) {
    return (
      <MasterDataLayout user={user}>
        <SectionCard title="Stock catalog">
          <p className="rounded border border-info-line bg-info-wash p-3 text-sm text-info-ink">
            Your role does not author templates, and the stock catalog is authoring master data
            (ADR 0015 §7). You can build assets from a published template instead. Ask a
            master-data administrator to import a catalog entry.
          </p>
          <BackToAllTemplates />
        </SectionCard>
      </MasterDataLayout>
    );
  }

  if (stockQ.isPending) {
    return (
      <MasterDataLayout user={user}>
        <p className="p-4 text-sm text-ink-muted">Loading the stock catalog…</p>
      </MasterDataLayout>
    );
  }

  if (stockQ.isError) {
    return (
      <MasterDataLayout user={user}>
        <SectionCard title="Stock catalog">
          <p className="rounded border border-critical-line bg-critical-wash p-3 text-sm text-critical-ink-strong">
            {apiErrorMessage(stockQ.error)}
          </p>
          <BackToAllTemplates />
        </SectionCard>
      </MasterDataLayout>
    );
  }

  if (!entry || !view) {
    // The raw `:code` is echoed as a text node (React escapes it), cut to the
    // 64 characters a real stock code can have: a crafted deep link should not
    // be able to fill an admin panel with attacker-chosen text.
    return (
      <MasterDataLayout user={user}>
        <SectionCard title="Stock catalog">
          <p className="rounded border border-warning-line bg-warning-wash p-3 text-sm text-warning-ink">
            The stock catalog carries no entry with the code “{(code ?? "").slice(0, 64)}”. It
            may have been renamed, or the link may be older than the catalog.
          </p>
          <BackToAllTemplates />
        </SectionCard>
      </MasterDataLayout>
    );
  }

  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow={`Stock catalog · ${entry.code}`}
        title={entry.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill label="Stock catalog · read only" tone="info" />
            <span>
              {entry.code} · {entry.domain} · {entry.assetType} · stock v{entry.stockVersion} ·{" "}
              {entry.points.length} point{entry.points.length === 1 ? "" : "s"}
            </span>
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/admin/asset-templates"
              className="surface-button px-3 py-1.5"
            >
              Back to all templates
            </Link>
            {/* `F4.254` PR 2 — opens the Import wizard. It is handed the
                **resolved entry**, so the request names `entry.code`, never
                `code` from the URL; it lands on the new draft (ADR 0052
                decision 10), exactly as the card's Import does. */}
            <button
              type="button"
              aria-label={`Import ${entry.name}`}
              onClick={() => {
                setClosedError(null);
                setImportOpen(true);
              }}
              className="surface-button-primary bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent"
            >
              Import
            </button>
          </div>
        }
      />

      {closedError ? (
        <p className="rounded border border-critical-line bg-critical-wash p-3 text-sm text-critical-ink-strong">
          {closedError}
        </p>
      ) : null}

      <p className="rounded border border-info-line bg-info-wash p-3 text-xs text-info-ink">
        This is repository data (ADR 0052). It cannot be edited here — import it into an
        organization to author a draft of your own.
      </p>

      <SectionCard>
        <TemplateTabStrip active={tab} onSelect={openTab} />
        <div className="pt-3">
          <TemplateTabBody
            tab={tab}
            template={view}
            editable={false}
            onSaved={NEVER_SAVED}
            onDirtyChange={NO_DIRTY}
          />
        </div>
      </SectionCard>

      {importOpen ? (
        <ImportStockWizard
          entry={{ code: entry.code, name: entry.name }}
          onClose={() => setImportOpen(false)}
          onClosedError={setClosedError}
        />
      ) : null}
    </MasterDataLayout>
  );
}

/** The one way out of every refusal branch on this page. */
function BackToAllTemplates() {
  return (
    <Link
      to="/admin/asset-templates"
      className="mt-3 inline-block text-xs font-semibold text-accent-strong hover:underline"
    >
      Back to all templates
    </Link>
  );
}
