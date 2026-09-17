/**
 * The read-only viewer for one stock dashboard-template catalog entry
 * (`F3.44`, ADR 0049 decision 3).
 *
 * An administrator can read a stock entry in full before deciding to import
 * it. The entry's widgets render through the **same `DashboardCanvas` preview
 * and the same `WidgetEditor`** the authoring detail page uses, with
 * `editable={false}`, so there is exactly one description of what a canvas
 * looks like rather than a second read-only copy that drifts.
 *
 * ## Why there is no adapter and no detail-page reuse (plan §5.1)
 *
 * `F2.14` shaped a stock asset entry as a row DTO and fed it to the detail
 * page's tabs. That is not safe here: every header control on
 * `dashboard-template-detail-page.tsx` is gated on the row's `status`, not on
 * `editable` — `draft` renders Publish and Delete, `published` renders
 * Archive, Edit-this-version and Instantiate (which posts `template.id`),
 * `archived` renders Revive — so **no synthetic status a stock entry could
 * carry renders zero live mutation controls**. The shared rendering is the
 * part below that header: `DashboardCanvas` plus `WidgetEditor` plus one
 * empty-state sentence, none of which reads a template id. This page therefore
 * never holds a `DashboardTemplateDto` and never holds a row id: it reads the
 * `StockDashboardTemplateDto` straight off the list response the card already
 * fetched.
 *
 * **Nothing here writes to the catalog, and nothing can.** `WidgetEditor`
 * keeps *Remove*, the binding `×` and the `AssetRoleBindingPicker` under
 * `{editable ? … : null}`, and this page passes the literal `false`. The one
 * writable control on the screen is the header's organization picker, which
 * feeds Import — and Import creates a *new* row rather than changing the entry.
 *
 * ## `:code` is validated by the lookup, not by a regex
 *
 * The entry is either in the already-fetched list response or it is not, and
 * an absent one renders the not-found panel. **The load-bearing rule is the
 * other one: Import sends the resolved `entry.code`, never the raw URL
 * parameter.**
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  fetchAdminStockDashboardTemplates,
  importAdminStockDashboardTemplate,
} from "../../api/admin/dashboard-templates";
import type { SectionTemplateWidgetInput } from "../../api/admin/dashboard-templates";
import { fetchAdminOrganizations } from "../../api/admin/organizations";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import {
  WidgetEditor,
  renderTemplateTile,
} from "../../components/dashboard-templates/widget-editor";
import { DashboardCanvas } from "../../components/dashboards/dashboard-canvas";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { apiErrorMessage } from "../../lib/api-error-message";
import { findStockEntry } from "../../lib/stock-template-view";
import { canAuthorTemplates } from "../../lib/template-authoring-access";
import type { AuthUser } from "../../stores/auth-store";

type DashboardTemplateStockViewPageProps = { user: AuthUser };

/**
 * The two callbacks `WidgetEditor` requires. Unlike the asset viewer's
 * `NO_DIRTY`, nothing here depends on their identity — `WidgetEditor` puts
 * neither in an effect dependency array. They are module-level for
 * readability, not correctness: with `editable={false}` no control that could
 * call them ever renders.
 */
const NO_CHANGE: (patch: Partial<SectionTemplateWidgetInput>) => void = () => {};
const NO_REMOVE: () => void = () => {};

/** Read-only view of one stock dashboard-template catalog entry. */
export function DashboardTemplateStockViewPage({ user }: DashboardTemplateStockViewPageProps) {
  const { code } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [importOrgId, setImportOrgId] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  const mayAuthor = canAuthorTemplates(user.role);

  // The **same query key as the stock card** on `dashboard-templates-page.tsx`,
  // so arriving from the card is a cache hit and a cold deep link fetches once.
  // Ungated, as the card is: the server admits every master-data role to this
  // list (`assertMasterDataRole` includes `location_admin`). The asset viewer
  // gates its fetch on `mayAuthor` because *its* server does not.
  const stockQ = useQuery({
    queryKey: ["admin", "dashboard-templates", "stock"],
    queryFn: fetchAdminStockDashboardTemplates,
  });
  const orgsQ = useQuery({
    queryKey: ["admin", "organizations", "true"],
    queryFn: () => fetchAdminOrganizations("true"),
    enabled: mayAuthor,
  });

  const entry = findStockEntry(stockQ.data?.items ?? [], code ?? "");
  const widgets: SectionTemplateWidgetInput[] = entry?.content.widgets ?? [];

  const importM = useMutation({
    mutationFn: (entryCode: string) => importAdminStockDashboardTemplate(entryCode, importOrgId),
    onSuccess: (created) => {
      setImportError(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "dashboard-templates"] });
      // Plan §5.5 — the viewer has no list to refresh, so a successful import
      // lands on the new draft. The card's Import stays on the list.
      navigate(`/admin/dashboard-templates/${created.id}`);
    },
    onError: (cause: Error) => setImportError(apiErrorMessage(cause)),
  });

  // No role branch: every role `AdminRoute` admits may read this list (§5.4),
  // so the pending branch comes first and cannot hang for anyone.
  if (stockQ.isPending) {
    return (
      <MasterDataLayout user={user}>
        <p className="p-4 text-sm text-bms-muted">Loading the stock catalog…</p>
      </MasterDataLayout>
    );
  }

  if (stockQ.isError) {
    return (
      <MasterDataLayout user={user}>
        <SectionCard title="Stock catalog">
          <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {apiErrorMessage(stockQ.error)}
          </p>
          <BackToAllTemplates />
        </SectionCard>
      </MasterDataLayout>
    );
  }

  if (!entry) {
    // The raw `:code` is echoed as a text node (React escapes it), cut to the
    // 64 characters a real stock code can have: a crafted deep link should not
    // be able to fill an admin panel with attacker-chosen text.
    return (
      <MasterDataLayout user={user}>
        <SectionCard title="Stock catalog">
          <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
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
              {entry.section} · stock v{entry.stockVersion} · {widgets.length} widget
              {widgets.length === 1 ? "" : "s"}
            </span>
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/admin/dashboard-templates"
              className="rounded border border-gray-200 px-3 py-1.5 text-xs font-semibold text-bms-muted"
            >
              All templates
            </Link>
            {mayAuthor ? (
              <>
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
                <button
                  type="button"
                  aria-label={`Import ${entry.name}`}
                  disabled={importOrgId === "" || importM.isPending}
                  onClick={() => {
                    setImportError(null);
                    // The **resolved entry's** code, never `code` from the URL.
                    importM.mutate(entry.code);
                  }}
                  className="rounded bg-bms-green px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                >
                  {importM.isPending ? "Importing…" : "Import"}
                </button>
              </>
            ) : null}
          </div>
        }
      />

      <p className="rounded border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
        This is repository data (ADR 0049 decision 3). It cannot be edited here — import it into
        an organization to author a draft of your own.
      </p>

      {entry.description ? <p className="text-sm text-bms-muted">{entry.description}</p> : null}

      {importError ? (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {importError}
        </p>
      ) : null}

      <SectionCard title="Canvas">
        {widgets.length === 0 ? (
          <p className="text-sm text-bms-muted">This template has no widgets.</p>
        ) : (
          <div className="space-y-3">
            <DashboardCanvas tiles={widgets} renderTile={renderTemplateTile} />
            {widgets.map((row) => (
              <WidgetEditor
                key={row.key}
                row={row}
                editable={false}
                onChange={NO_CHANGE}
                onRemove={NO_REMOVE}
              />
            ))}
          </div>
        )}
      </SectionCard>
    </MasterDataLayout>
  );
}

/** The one way out of every refusal branch on this page. */
function BackToAllTemplates() {
  return (
    <Link
      to="/admin/dashboard-templates"
      className="mt-3 inline-block text-xs font-semibold text-bms-green hover:underline"
    >
      Back to all templates
    </Link>
  );
}
