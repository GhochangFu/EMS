import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import type { WidgetType } from "@bms/shared";

import { fetchAdminLocations } from "../../api/admin/locations";
import { fetchAdminOrganizations } from "../../api/admin/organizations";
import { createDashboard, putDashboardWidgets, type CreateDashboardPayload } from "../../api/dashboards";
import { apiErrorMessage } from "../../lib/api-error-message";
import {
  blankDashboardWidgetRow,
  buildPutWidgetsPayload,
  dashboardBuilderErrors,
  dashboardBuilderProblemSubject,
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
import { WidgetInspector } from "../../components/dashboards/widget-inspector";
import type { AuthUser } from "../../stores/auth-store";

type DashboardBuilderPageProps = {
  user: AuthUser;
};

type WidgetTile = CanvasTile & { row: DashboardWidgetRow; index: number };

/**
 * `F3.1d` Unit 7 — creates a dashboard. Lives under `/admin/…` deliberately
 * (plan §6.1): it removes the reserved-slug problem a flat `/dashboards/new`
 * would create, since `dashboardFieldsSchema.slug` permits the literal `new`.
 *
 * **Save is two calls, in order** (plan §7/§8 Unit 7): `POST /dashboards`,
 * then `PUT /:id/widgets` with the whole set. Not atomic — a failed second
 * call leaves an empty dashboard, which is `F3.1d` Unit 9's problem to state
 * rather than hide; this row does not implement the duplicate flow that
 * raises it.
 */
export function DashboardBuilderPage({ user }: DashboardBuilderPageProps) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [scope, setScope] = useState<DashboardScopeValue>({
    kind: "location",
    organizationId: "",
    locationId: "",
  });
  const [rows, setRows] = useState<DashboardWidgetRow[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const organizationsQ = useQuery({
    queryKey: ["admin", "organizations", "for-dashboard-create"],
    queryFn: () => fetchAdminOrganizations("true"),
  });
  const locationsQ = useQuery({
    queryKey: ["admin", "locations", "for-dashboard-create"],
    queryFn: () => fetchAdminLocations("true"),
  });

  const problems = dashboardBuilderErrors(rows);
  // Review finding — `WidgetInspector` (below) renders only the SELECTED widget's problems, so
  // a set-level problem or another widget's problem must surface somewhere else, or `Save`
  // disables with a reason nothing on the page shows.
  const summaryProblems = unselectedDashboardBuilderProblems(problems, selected);
  const scopeChosen = scope.kind === "organization" ? scope.organizationId !== "" : scope.locationId !== "";
  const blocked = name.trim() === "" || slug.trim() === "" || !scopeChosen || problems.length > 0;

  const saveM = useMutation({
    mutationFn: async () => {
      const body: CreateDashboardPayload = {
        organizationId: scope.organizationId,
        slug: slug.trim(),
        name: name.trim(),
        ...(scope.kind === "location" ? { locationId: scope.locationId } : {}),
      };
      const created = await createDashboard(body);
      await putDashboardWidgets(created.id, buildPutWidgetsPayload(rows));
      return created;
    },
    onSuccess: (created) => {
      setError(null);
      navigate(`/admin/dashboards/${created.slug}?organizationId=${created.organizationId}`);
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
    <AppShell user={user} kpiRibbon={<span className="text-bms-ink">Dashboard builder</span>}>
      <div className="mx-auto max-w-[1400px] space-y-4 pb-8">
        <PageHeader
          eyebrow="Admin"
          title="Create dashboard"
          subtitle="Compose widgets on the 12-column canvas, bind points, and save"
        />

        {error ? <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}

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
              <span className="font-semibold uppercase tracking-wide text-bms-muted">Slug</span>
              <input
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
              />
            </label>
          </div>
          <div className="mt-3">
            <DashboardScopeFields
              role={user.role}
              value={scope}
              onChange={setScope}
              organizations={organizationsQ.data?.items ?? []}
              locations={locationsQ.data?.items ?? []}
            />
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
            organizationId={scope.organizationId}
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
            {saveM.isPending ? "Saving…" : "Create dashboard"}
          </button>
          {problems.length > 0 ? (
            <div className="text-[11px] text-bms-muted">
              <p>Fix the problems below to save.</p>
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
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
