import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { fetchAssets } from "../../api/assets";
import {
  fetchDashboard,
  putDashboardWidgets,
  updateDashboard,
  type UpdateDashboardPayload,
} from "../../api/dashboards";
import { useDashboardScopeOptions } from "../../hooks/use-dashboard-scope-options";
import { apiErrorMessage } from "../../lib/api-error-message";
import {
  isScopeAuthorised,
  isScopeChosen,
  scopeChanged,
  scopeFromDashboard,
  scopePatch,
  type ScopeAssetOption,
} from "../../lib/dashboard-scope";
import {
  blankDashboardWidgetRow,
  buildPutWidgetsPayload,
  builderHasChanged,
  dashboardBuilderErrors,
  dashboardBuilderProblemSubject,
  dashboardRowsFromDto,
  unselectedDashboardBuilderProblems,
  type DashboardWidgetRow,
} from "../../lib/dashboard-builder-form";
import { WIDGET_CATALOG } from "../../lib/widget-catalog";
import { WIDGET_TYPES } from "../../lib/widget-config-form";
import { AppShell } from "../../layouts/app-shell";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { DashboardCanvas, type CanvasTile } from "../../components/dashboards/dashboard-canvas";
import { DashboardScopeFields, type DashboardScopeValue } from "../../components/dashboards/dashboard-scope-fields";
import { DuplicateDashboardDialog } from "../../components/dashboards/duplicate-dashboard-dialog";
import { WidgetInspector } from "../../components/dashboards/widget-inspector";
import type { AuthUser } from "../../stores/auth-store";
import type { WidgetType } from "@bms/shared";

type DashboardBuilderEditPageProps = {
  user: AuthUser;
};

type WidgetTile = CanvasTile & { row: DashboardWidgetRow; index: number };

/**
 * `F3.1d` Unit 7 — edits an existing dashboard's scope, arrangement, config
 * and bindings. **Never touches `organizationId`** — a dashboard's tenant is
 * fixed at creation (`UpdateDashboardBody` carries no such field), so
 * `DashboardScopeFields`'s organization-wide branch is fed a single,
 * already-fixed option rather than a real picker: there is nothing to choose.
 *
 * Save is the same two calls Unit 7's create page makes, in the same order:
 * `PATCH /dashboards/:id`, then `PUT /:id/widgets` with the whole set —
 * preserving every server-issued widget `id` so a re-save does not invent new
 * rows for widgets that already exist (`dashboardRowsFromDto` is what carries
 * them forward).
 *
 * `F3.63` (ADR 0047 Amendment 6): the option lists come from `useDashboardScopeOptions` by
 * role, so an `asset_group_admin` — admitted by `DashboardAuthorRoute` — edits its group
 * dashboard from `/auth/me`'s `scope.assetGroups` with no `/admin/*` read; and an
 * asset-scoped row (ADR 0067) prefills as the read-only `asset` kind, whose PATCH omits both
 * scope columns (`scopePatch`) — see the comment on the save body below.
 */
export function DashboardBuilderEditPage({ user }: DashboardBuilderEditPageProps) {
  const { slug = "" } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const organizationIdParam = searchParams.get("organizationId") ?? undefined;
  const queryClient = useQueryClient();

  const dashboardQ = useQuery({
    queryKey: ["dashboards", "detail", slug, organizationIdParam],
    queryFn: () => fetchDashboard(slug, organizationIdParam),
    enabled: slug !== "",
  });
  const dto = dashboardQ.data;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<DashboardScopeValue>({
    kind: "location",
    organizationId: "",
    locationId: "",
  });
  const [rows, setRows] = useState<DashboardWidgetRow[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ADR 0047 Amendment 2 ruling 3's duplicate action needs a way in, and this page is it: the
  // ruling reserved the organization-wide dashboard to the two organization-level roles and
  // named copy as the replacement route by which a site admin's good dashboard reaches another
  // plant. A dialog no page renders satisfies none of that, so the entry point is part of the
  // obligation rather than a nicety on top of it.
  const [duplicating, setDuplicating] = useState(false);

  useEffect(() => {
    if (!dto) {
      return;
    }
    setName(dto.name);
    setDescription(dto.description ?? "");
    // Four-way (`F3.34`, then `F3.63`): an asset-group dashboard prefills as one, and an
    // asset-scoped row as the read-only `asset` kind. Before `F3.34` the prefill was two-way and
    // a rename silently widened a group dashboard to the tenant. Before `F3.63` an asset-scoped
    // row showed a false organization radio; a rename kept its `assetId` (the two nulls merged
    // onto one axis, so the save succeeded silently) and choosing a location or a group was a
    // 400 (Amendment 6 §Q2).
    setScope(scopeFromDashboard(dto));
    setRows(dashboardRowsFromDto(dto));
    setSelected(null);
  }, [dto]);

  // Both lists narrowed to the dashboard's own organization (`F3.34`), read by role (`F3.63`).
  const { locations, assetGroups } = useDashboardScopeOptions({
    role: user.role,
    organizationId: dto?.organizationId,
    enabled: !!dto,
  });
  // Names the read-only asset line; only an asset-scoped row has one to name. The key is
  // `PointPicker`'s for the same fetch, so the cache is shared.
  const assetsQ = useQuery({
    queryKey: ["assets", "dashboard-scope", dto?.organizationId],
    queryFn: () => fetchAssets(dto?.organizationId),
    enabled: !!dto?.assetId,
  });
  const assets: readonly ScopeAssetOption[] = (assetsQ.data ?? []).map((asset) => ({ id: asset.id, name: asset.name }));

  const problems = dashboardBuilderErrors(rows);
  // Review finding — `WidgetInspector` (below) renders only the SELECTED widget's problems, so
  // a set-level problem or another widget's problem must surface somewhere else, or `Save`
  // disables with a reason nothing on the page shows.
  const summaryProblems = unselectedDashboardBuilderProblems(problems, selected);
  const fieldsChanged = dto
    ? name !== dto.name || description !== (dto.description ?? "") || scopeChanged(scope, dto)
    : false;
  const widgetsChanged = dto ? builderHasChanged(rows, dto) : false;
  const changed = fieldsChanged || widgetsChanged;
  // Chosen AND authorised (`F3.63` review, then its post-merge sweep): a location or a group a
  // SCOPED role's option list does not hold — a foreign scope the role can open but not save —
  // leaves the select without a matching option while `isScopeChosen` is still true; without
  // the second predicate a rename enabled Save and the PATCH ended in the server's 404. For
  // `admin` / `organization_admin` the list is a picker of ACTIVE rows, not a boundary, so an
  // absent id does not block them — the sweep's regression was an `admin` on a dashboard whose
  // location was set inactive, Save disabled with no reason shown. `isScopeAuthorised` is the
  // one place the role rule lives; the duplicate dialog composes the same helper. See
  // `isScopeOffered`'s docblock for why a still-loading list counts as "not offered".
  const scopeAuthorised = isScopeAuthorised(user.role, scope, { locations, assetGroups });
  const scopeChosen = isScopeChosen(scope) && scopeAuthorised;
  const blocked = !dto || name.trim() === "" || !scopeChosen || problems.length > 0 || !changed;
  // Save never disables with a reason nothing on the page shows (the `F3.34` review's rule):
  // the two scope reasons rank above "No changes yet.", which is also true of an unedited
  // foreign-scope dashboard and would otherwise mask them. UNCHOSEN is judged before
  // UNAUTHORISED: an empty id fails `isScopeOffered` too, so the clamp path — a
  // `location_admin` on a group dashboard, rewritten to an unchosen location — would otherwise
  // read as "outside your scope" when nothing is scoped outside anything.
  const saveReason =
    problems.length > 0
      ? "Fix the problems below to save."
      : !isScopeChosen(scope)
        ? "Choose a scope to save."
        : !scopeAuthorised
          ? "This dashboard is scoped to a location or asset group outside your scope, so it cannot be saved here."
          : !changed
            ? "No changes yet."
            : "";

  const saveM = useMutation({
    mutationFn: async () => {
      if (!dto) {
        throw new Error("Dashboard has not loaded yet");
      }
      // Both scope columns are sent explicitly on every save of a CHOSEN kind (`F3.34`, plan
      // §10 Q1). `updateDashboard`'s body merges on presence, so an explicit `null` clears a
      // column — which is correct here because the prefill is `scopeFromDashboard` and this
      // form renders the asset-group control: a group source round-trips its own id, and a
      // null is only ever sent for the axis the author did not choose. `scopePatch` never
      // yields two non-nulls, so `DashboardsService.update`'s merged singularity guard holds.
      // For the read-only `asset` kind (`F3.63`, ADR 0047 Amendment 6 §Q2) `scopePatch` is
      // `{}`: both scope columns are OMITTED, not sent as null, so a rename of an asset-scoped
      // dashboard touches neither — the spec pins the body's keys exactly. `assetId` (ADR 0067)
      // is never sent either, so an asset-scoped row keeps it — pinned exactly too, because the
      // merge-on-presence would read `assetId: null` as "clear the provenance". A
      // `location_admin` CAN open a group-scoped dashboard here (the read is `getBySlug`,
      // organization-wide by ADR 0047 Amendment 2, and `DashboardAuthorRoute` admits the role),
      // but two controls hold: the fields' clamp rewrites a kind the role is not offered to an
      // unchosen location, so Save stays disabled until a location is picked, and the PATCH
      // that then follows meets `update`'s STORED-scope check first, which refuses the role on
      // the group arm with a 404 (review finding — the refusal is at save, not at load). The
      // same two roles can also open a dashboard of THEIR OWN kind but outside their grant — a
      // `location_admin` on a location it does not hold, an `asset_group_admin` on a group it
      // does not hold (`F3.63` review): the clamp does not fire (the kind is offered), so it is
      // `isScopeAuthorised` in `blocked` above that keeps Save disabled there, and the 404 the
      // PATCH would otherwise meet is never reached.
      const body: UpdateDashboardPayload = {
        name: name.trim(),
        description: description.trim() === "" ? null : description.trim(),
        ...scopePatch(scope),
      };
      const updated = await updateDashboard(dto.id, body);
      return putDashboardWidgets(updated.id, buildPutWidgetsPayload(rows));
    },
    onSuccess: (next) => {
      setError(null);
      queryClient.setQueryData(["dashboards", "detail", slug, organizationIdParam], next);
    },
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });

  function addWidget(widgetType: WidgetType): void {
    setRows((current) => {
      const next = [...current, blankDashboardWidgetRow(widgetType)];
      setSelected(next.length - 1);
      return next;
    });
  }

  function updateWidget(index: number, patch: Partial<DashboardWidgetRow>): void {
    setRows((current) => current.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  }

  function removeWidget(index: number): void {
    setRows((current) => current.filter((_, position) => position !== index));
    setSelected((current) => (current === index ? null : current));
  }

  const tiles: WidgetTile[] = rows.map((row, index) => ({
    key: row.id ?? `new-${index}`,
    gridX: row.gridX,
    gridY: row.gridY,
    gridW: row.gridW,
    gridH: row.gridH,
    row,
    index,
  }));

  const selectedRow = selected !== null ? rows[selected] : undefined;

  return (
    <AppShell user={user} kpiRibbon={<span className="text-bms-ink">{dto?.name ?? "Edit dashboard"}</span>}>
      <div className="mx-auto max-w-[1400px] space-y-4 pb-8">
        <PageHeader eyebrow="Admin" title={dto?.name ?? "Edit dashboard"} subtitle={slug} />

        {dashboardQ.isError ? (
          <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {apiErrorMessage(dashboardQ.error as Error)}
          </p>
        ) : null}
        {error ? <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}

        {dto ? (
          <>
            <SectionCard title="Dashboard">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block space-y-1 text-xs">
                  <span className="font-semibold uppercase tracking-wide text-bms-muted">Name</span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
                  />
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="font-semibold uppercase tracking-wide text-bms-muted">Description</span>
                  <input
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
                  />
                </label>
              </div>
              <div className="mt-3">
                <DashboardScopeFields
                  role={user.role}
                  value={scope}
                  onChange={setScope}
                  organizations={[{ id: dto.organizationId, name: "This dashboard's organization" }]}
                  locations={locations}
                  assetGroups={assetGroups}
                  assets={assets}
                />
              </div>
              <div className="mt-3 border-t border-gray-100 pt-3">
                <button
                  type="button"
                  onClick={() => setDuplicating(true)}
                  className="rounded border border-gray-300 px-3 py-1.5 text-xs font-semibold text-bms-ink hover:bg-gray-50"
                >
                  Duplicate this dashboard
                </button>
                <p className="mt-1 text-xs text-bms-muted">
                  Copies this dashboard into a scope you may already write to. The copy stays in this
                  organization.
                </p>
              </div>
            </SectionCard>

            <SectionCard
              title="Widgets"
              actions={
                <div className="flex flex-wrap gap-2">
                  {WIDGET_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => addWidget(type)}
                      className="rounded border border-gray-200 px-2 py-1 text-[11px] font-semibold text-bms-ink"
                    >
                      + {WIDGET_CATALOG[type].label}
                    </button>
                  ))}
                </div>
              }
            >
              {rows.length === 0 ? (
                <p className="rounded border border-dashed border-gray-300 p-4 text-xs text-bms-muted">
                  Add a widget to start composing this dashboard.
                </p>
              ) : (
                <DashboardCanvas
                  tiles={tiles}
                  renderTile={(tile) => (
                    <button
                      type="button"
                      onClick={() => setSelected(tile.index)}
                      className={`h-full w-full rounded border p-2 text-left text-xs ${
                        tile.index === selected ? "border-bms-green bg-bms-green/10" : "border-gray-200 bg-white"
                      }`}
                    >
                      <div className="font-semibold">
                        {tile.row.title.trim() || WIDGET_CATALOG[tile.row.widgetType].label}
                      </div>
                      <div className="text-[10px] text-bms-muted">
                        {WIDGET_CATALOG[tile.row.widgetType].label} · {tile.row.points.length} point(s)
                      </div>
                    </button>
                  )}
                  onArrange={(key, next) => {
                    const tile = tiles.find((candidate) => candidate.key === key);
                    if (tile) {
                      updateWidget(tile.index, next);
                    }
                  }}
                />
              )}
            </SectionCard>

            {selected !== null && selectedRow ? (
              <WidgetInspector
                row={selectedRow}
                role={user.role}
                problems={problems.filter((problem) => problem.widget === selected)}
                organizationId={dto.organizationId}
                onChange={(patch) => updateWidget(selected, patch)}
                onRemove={() => removeWidget(selected)}
              />
            ) : null}

            <div className="flex items-start gap-3 border-t border-gray-200 pt-3">
              <button
                type="button"
                disabled={blocked || saveM.isPending}
                onClick={() => saveM.mutate()}
                className="rounded bg-bms-green px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              >
                {saveM.isPending ? "Saving…" : "Save dashboard"}
              </button>
              <div className="text-[11px] text-bms-muted">
                <p>{saveReason}</p>
                {summaryProblems.length > 0 ? (
                  <ul className="mt-1 space-y-0.5 text-red-700">
                    {summaryProblems.map((problem, index) => (
                      <li key={index}>
                        <span className="font-semibold">{dashboardBuilderProblemSubject(rows, problem)}:</span>{" "}
                        {problem.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>

            {duplicating ? (
              <DuplicateDashboardDialog
                sourceSlug={dto.slug}
                sourceOrganizationId={dto.organizationId}
                role={user.role}
                onClose={() => setDuplicating(false)}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
