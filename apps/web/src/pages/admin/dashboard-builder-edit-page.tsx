import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { fetchAdminLocations } from "../../api/admin/locations";
import {
  fetchDashboard,
  putDashboardWidgets,
  updateDashboard,
  type UpdateDashboardPayload,
} from "../../api/dashboards";
import { apiErrorMessage } from "../../lib/api-error-message";
import {
  blankDashboardWidgetRow,
  buildPutWidgetsPayload,
  builderHasChanged,
  dashboardBuilderErrors,
  dashboardRowsFromDto,
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
    setScope(
      dto.locationId
        ? { kind: "location", organizationId: dto.organizationId, locationId: dto.locationId }
        : { kind: "organization", organizationId: dto.organizationId },
    );
    setRows(dashboardRowsFromDto(dto));
    setSelected(null);
  }, [dto]);

  const locationsQ = useQuery({
    queryKey: ["admin", "locations", "for-dashboard-edit", dto?.organizationId],
    queryFn: () => fetchAdminLocations("true", dto?.organizationId),
    enabled: !!dto,
  });

  const problems = dashboardBuilderErrors(rows);
  const scopeChanged = dto
    ? scope.kind !== (dto.locationId ? "location" : "organization") ||
      (scope.kind === "location" && scope.locationId !== dto.locationId)
    : false;
  const fieldsChanged = dto ? name !== dto.name || description !== (dto.description ?? "") || scopeChanged : false;
  const widgetsChanged = dto ? builderHasChanged(rows, dto) : false;
  const changed = fieldsChanged || widgetsChanged;
  const scopeChosen = scope.kind === "organization" ? scope.organizationId !== "" : scope.locationId !== "";
  const blocked = !dto || name.trim() === "" || !scopeChosen || problems.length > 0 || !changed;

  const saveM = useMutation({
    mutationFn: async () => {
      if (!dto) {
        throw new Error("Dashboard has not loaded yet");
      }
      const body: UpdateDashboardPayload = {
        name: name.trim(),
        description: description.trim() === "" ? null : description.trim(),
        locationId: scope.kind === "location" ? scope.locationId : null,
        // `assetGroupId` is deliberately OMITTED, never sent as `null`. `updateDashboard`'s
        // body merges on presence, not truthiness, so an explicit `null` would CLEAR the
        // column on every save — widening a plant-area dashboard to the whole tenant with
        // no signal anywhere on the page (the class ADR 0047 Amendment 1 rejected `ON DELETE
        // SET NULL` for). `DashboardScopeFields` offers no asset-group control on this page,
        // so this page has no authority to touch that column at all.
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
                  locations={locationsQ.data?.items ?? []}
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
                problems={problems.filter((problem) => problem.widget === selected)}
                organizationId={dto.organizationId}
                onChange={(patch) => updateWidget(selected, patch)}
                onRemove={() => removeWidget(selected)}
              />
            ) : null}

            <div className="flex items-center gap-3 border-t border-gray-200 pt-3">
              <button
                type="button"
                disabled={blocked || saveM.isPending}
                onClick={() => saveM.mutate()}
                className="rounded bg-bms-green px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              >
                {saveM.isPending ? "Saving…" : "Save dashboard"}
              </button>
              <span className="text-[11px] text-bms-muted">
                {problems.length > 0 ? "Fix the problems above to save." : !changed ? "No changes yet." : ""}
              </span>
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
