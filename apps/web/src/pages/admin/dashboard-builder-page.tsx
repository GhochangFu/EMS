import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { DashboardDto, WidgetType } from "@bms/shared";
import type { CreateDashboardBody } from "@bms/shared/contracts";
import { catalogEntry } from "@bms/shared/copilot";

import { fetchAdminOrganizations } from "../../api/admin/organizations";
import { createDashboard, putDashboardWidgets } from "../../api/dashboards";
import { useDashboardScopeOptions } from "../../hooks/use-dashboard-scope-options";
import { canCreateOrganizationWideDashboard } from "../../lib/admin-access";
import { apiErrorMessage } from "../../lib/api-error-message";
import { scopeColumns, scopeFromDashboard, type ChosenScopeValue } from "../../lib/dashboard-scope";
import { chosenScopeFromFill } from "../../lib/dashboard-scope-fill";
import {
  DASHBOARD_SLUG_HINT,
  DASHBOARD_SLUG_MAX,
  DASHBOARD_SLUG_MIN,
  DASHBOARD_SLUG_PATTERN,
} from "../../lib/dashboard-slug";
import {
  blankDashboardWidgetRow,
  buildPutWidgetsPayload,
  dashboardBuilderErrors,
  dashboardBuilderProblemSubject,
  offerableWidgetTypes,
  unselectedDashboardBuilderProblems,
  type DashboardWidgetRow,
  type PutDashboardWidgetsPayload,
} from "../../lib/dashboard-builder-form";
import type { WizardStep } from "../../lib/wizard-steps";
import { WIDGET_CATALOG } from "../../lib/widget-catalog";
import { AppShell } from "../../layouts/app-shell";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { DashboardCanvas, type CanvasTile } from "../../components/dashboards/dashboard-canvas";
import { clampScopeToRole, DashboardScopeFields } from "../../components/dashboards/dashboard-scope-fields";
import { WidgetInspector } from "../../components/dashboards/widget-inspector";
import { WizardShell } from "../../components/wizard/wizard-shell";
import type { AuthUser } from "../../stores/auth-store";

type DashboardBuilderPageProps = {
  user: AuthUser;
};


type WidgetTile = CanvasTile & { row: DashboardWidgetRow; index: number };

/** The edit page of a dashboard — where a created dashboard lives from now on. */
function editPath(dto: Pick<DashboardDto, "slug" | "organizationId">): string {
  return `/admin/dashboards/${dto.slug}?organizationId=${dto.organizationId}`;
}

/**
 * `F3.1d` Unit 7 — creates a dashboard. Lives under `/admin/…` deliberately
 * (plan §6.1): it removes the reserved-slug problem a flat `/dashboards/new`
 * would create, since `dashboardFieldsSchema.slug` permits the literal `new`.
 *
 * **`F3.85` PR 9 (ADR 0099 decision 6, plan §11.1) — two wizards, in order.** The first is
 * `dashboard.create` (Basics → Scope → Review, `POST /dashboards`). Only once it has answered
 * does the page open the second, `dashboard.widgets.replace` (Layout → Review,
 * `PUT /:id/widgets`) on the new dashboard's id; before that there is no widgets card to submit.
 * The builder's canvas and inspector are the Layout step. Not atomic, as before: a dashboard
 * whose widgets are never saved stays an empty dashboard, which its edit page opens. Neither
 * wizard sends `X-Copilot-Change` — a copilot write goes through the dock's Confirm card only.
 *
 * **The scope state is `ChosenScopeValue`, not `DashboardScopeValue`** (`F3.63`, plan §4.1
 * point 3): a create body can never carry ADR 0067's `assetId`, and typing the state to the
 * three chosen kinds makes that a compile-time fact — `scopeColumns` takes only this type. The
 * option lists come from `useDashboardScopeOptions` by role (ADR 0047 Amendment 6 §Q1 point
 * 2): an `asset_group_admin` reaches this page through `DashboardAuthorRoute`, is offered the
 * group kind only, and its list is `/auth/me`'s `scope.assetGroups` — none of the three
 * `/admin/*` reads fire for it, since each is a 403 for the role. `organizationId` on the body
 * is the scope value's, which for the group kind is the chosen group's own.
 */
export function DashboardBuilderPage({ user }: DashboardBuilderPageProps) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<ChosenScopeValue>({
    kind: "location",
    organizationId: "",
    locationId: "",
  });
  const [rows, setRows] = useState<DashboardWidgetRow[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [widgetsError, setWidgetsError] = useState<string | null>(null);
  // Bumped by Cancel: the first wizard remounts on its first step with the form cleared.
  const [round, setRound] = useState(0);
  // `F3.85` PR 9 — the dashboard the first wizard created; the second (widgets) wizard opens only then.
  const [created, setCreated] = useState<DashboardDto | null>(null);

  // Only the roles offered the organization-wide kind read the organization list — for the
  // two others it is a 403 nothing on the form would display.
  const organizationsQ = useQuery({
    queryKey: ["admin", "organizations", "for-dashboard-create"],
    queryFn: () => fetchAdminOrganizations("true"),
    enabled: canCreateOrganizationWideDashboard(user.role),
  });
  // No organization narrows the lists here: the location or group the author picks is what
  // DECIDES this dashboard's organization.
  const { locations, assetGroups } = useDashboardScopeOptions({ role: user.role });

  // The widgets are composed on the CREATED dashboard's scope, which no step can change any more.
  const widgetsScopeKind = created ? scopeFromDashboard(created).kind : scope.kind;
  // A new dashboard has no tabs yet (F3.73 PR1): the PUT below sends [] too.
  const problems = dashboardBuilderErrors(rows, widgetsScopeKind, []);
  // Review finding — `WidgetInspector` (below) renders only the SELECTED widget's problems, so
  // a set-level problem or another widget's problem must surface somewhere else, or the save
  // refuses with a reason nothing on the page shows.
  const summaryProblems = unselectedDashboardBuilderProblems(problems, selected);

  // The create body is the first wizard's values. An empty text field is left unset, so a step
  // never fails for a field not yet typed (the Review step parses the whole body). Both scope
  // columns are sent explicitly, exactly one non-null or both null (`scopeColumns`); an unchosen
  // location or group stays `""`, which the Scope step refuses as not an id.
  const createValues: Record<string, unknown> = {
    organizationId: scope.organizationId === "" ? undefined : scope.organizationId,
    slug: slug.trim() === "" ? undefined : slug.trim(),
    name: name.trim() === "" ? undefined : name.trim(),
    description: description.trim() === "" ? undefined : description.trim(),
    ...scopeColumns(scope),
  };
  const organizationName =
    organizationsQ.data?.items.find((organization) => organization.id === scope.organizationId)?.name ??
    "this organization";
  const createEntry = catalogEntry("dashboard.create");
  const widgetsEntry = catalogEntry("dashboard.widgets.replace");

  // The widgets body: the builder's rows, no tabs (a new dashboard has none).
  const widgetsValues: Record<string, unknown> = { ...buildPutWidgetsPayload(rows, []) };

  /** A copilot `fill_step` (or any change the shell makes) mapped back onto the typed state. */
  function applyCreateValues(next: Record<string, unknown>): void {
    setName(typeof next.name === "string" ? next.name : "");
    setSlug(typeof next.slug === "string" ? next.slug : "");
    setDescription(typeof next.description === "string" ? next.description : "");
    // Review fix (C3) — the kind is read from the column the fill changed.
    setScope((current) => chosenScopeFromFill(current, next));
  }

  function cancelCreate(): void {
    setName("");
    setSlug("");
    setDescription("");
    setScope({ kind: "location", organizationId: "", locationId: "" });
    createM.reset();
    setRound((current) => current + 1);
  }

  const createM = useMutation({
    // The plain request: a wizard used alone sends no `X-Copilot-Change` header (plan §10.5).
    mutationFn: (body: CreateDashboardBody) => createDashboard(body),
    onSuccess: (dto) => {
      setRows([]);
      setSelected(null);
      setCreated(dto);
    },
  });

  const widgetsM = useMutation({
    mutationFn: (body: PutDashboardWidgetsPayload) => {
      if (!created) {
        throw new Error("The dashboard has not been created yet");
      }
      return putDashboardWidgets(created.id, body);
    },
    onSuccess: () => {
      setWidgetsError(null);
      if (created) {
        navigate(editPath(created));
      }
    },
    onError: (cause: Error) => setWidgetsError(apiErrorMessage(cause)),
  });

  // Review fix (PR9-SEC-2) — `DashboardScopeFields`'s clamp, applied by the page too: the fields
  // mount on the Scope step only, and a copilot fill can land on any step (`applyFill`). Without
  // this, a `{ locationId: null, assetGroupId: null }` fill on Basics or Review made an
  // organization-wide create body for a role that is never offered that kind.
  useEffect(() => {
    const clamped = clampScopeToRole(user.role, scope);
    if (clamped !== null) {
      // The clamp rewrites only to a chosen kind (never `asset`).
      setScope(clamped as ChosenScopeValue);
    }
  }, [user.role, scope]);

  // Review fix (C4) — Cancel discards click-only work too (a radio, a widget added), so the
  // shell's `dirty` prop is the page's own "changed" and the shell asks first.
  const createColumns = scopeColumns(scope);
  const createChanged =
    [name, slug, description].some((field) => field.trim() !== "") ||
    scope.organizationId !== "" ||
    (createColumns.locationId ?? "") !== "" ||
    (createColumns.assetGroupId ?? "") !== "";

  /** The widgets wizard's Cancel: the dashboard exists now, so leaving opens it with no widgets. */
  function leaveWidgets(): void {
    if (created) navigate(editPath(created));
  }

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

  function renderCreateStep(step: WizardStep) {
    if (step.id === "basics") {
      return (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block space-y-1 text-xs">
            <span className="font-semibold uppercase tracking-wide text-ink-muted">Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full surface-field px-2 py-1.5 text-xs"
            />
          </label>
          {/* The hint sits outside the `<label>` — see the instantiate
              dialog's note: a wrapping label folds its whole text into the
              field's accessible name. */}
          <div className="space-y-1">
            <label className="block space-y-1 text-xs">
              <span className="font-semibold uppercase tracking-wide text-ink-muted">Slug</span>
              <input
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                pattern={DASHBOARD_SLUG_PATTERN}
                minLength={DASHBOARD_SLUG_MIN}
                maxLength={DASHBOARD_SLUG_MAX}
                title={DASHBOARD_SLUG_HINT}
                aria-describedby="dashboard-slug-hint"
                className="w-full surface-field px-2 py-1.5 text-xs"
              />
            </label>
            <span id="dashboard-slug-hint" className="block text-[11px] text-ink-muted">
              {DASHBOARD_SLUG_HINT}
            </span>
          </div>
          <label className="block space-y-1 text-xs md:col-span-2">
            <span className="font-semibold uppercase tracking-wide text-ink-muted">Description</span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="w-full surface-field px-2 py-1.5 text-xs"
            />
          </label>
        </div>
      );
    }
    return (
      <DashboardScopeFields
        role={user.role}
        value={scope}
        // The fields never emit the `asset` kind (no radio, no select renders it, and
        // the clamp rewrites only to a chosen kind); the prop is typed to the full union
        // for the edit page, whose state can hold that kind.
        onChange={setScope}
        organizations={organizationsQ.data?.items ?? []}
        locations={locations}
        assetGroups={assetGroups}
        // This state type cannot hold the `asset` kind, so there is never an asset to name.
        assets={[]}
      />
    );
  }

  function renderLayoutStep() {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {/* `F3.32` (ADR 0079 decision 4): a plant mimic is offered only on a group scope. */}
          {offerableWidgetTypes(widgetsScopeKind).map((type) => (
            <button key={type} type="button" onClick={() => addWidget(type)} className="surface-button px-2 py-1">
              + {WIDGET_CATALOG[type].label}
            </button>
          ))}
        </div>
        {rows.length === 0 ? (
          <p className="rounded border border-dashed border-line-strong p-4 text-xs text-ink-muted">
            Add a widget to start composing this dashboard.
          </p>
        ) : (
          <DashboardCanvas
            tiles={tiles}
            renderTile={(tile) => (
              <button
                type="button"
                onClick={() => setSelected(tile.index)}
                className={`h-full w-full p-2 text-left text-xs ${
                  tile.index === selected ? "border-accent bg-accent/10" : "surface-raised-sm"
                }`}
              >
                <div className="font-semibold">{tile.row.title.trim() || WIDGET_CATALOG[tile.row.widgetType].label}</div>
                <div className="text-[10px] text-ink-muted">
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
        {selected !== null && selectedRow && created ? (
          <WidgetInspector
            row={selectedRow}
            role={user.role}
            problems={problems.filter((problem) => problem.widget === selected)}
            organizationId={created.organizationId}
            tabs={[]}
            onChange={(patch) => updateWidget(selected, patch)}
            onRemove={() => removeWidget(selected)}
          />
        ) : null}
        {problems.length > 0 ? (
          <div className="text-[11px] text-ink-muted">
            <p>Fix the problems below to save.</p>
            {summaryProblems.length > 0 ? (
              <ul className="mt-1 space-y-0.5 text-critical-ink">
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
    );
  }

  return (
    <AppShell user={user} kpiRibbon={<span className="text-ink">Dashboard builder</span>}>
      <div className="mx-auto max-w-[1400px] space-y-4 pb-8">
        <PageHeader
          eyebrow="Admin"
          title="Create dashboard"
          subtitle="Name and scope the dashboard, then compose its widgets on the 12-column canvas"
        />

        <SectionCard title="Dashboard">
          {created === null ? (
            <div role="region" aria-label="Create the dashboard">
              {createEntry ? (
                <WizardShell
                  key={round}
                  entry={catalogEntry("dashboard.create")!}
                  values={createValues}
                  onChange={applyCreateValues}
                  renderStep={renderCreateStep}
                  dirty={createChanged}
                  onSubmit={(body) => createM.mutate(body as CreateDashboardBody)}
                  onCancel={cancelCreate}
                  submitting={createM.isPending}
                  submitError={createM.error ? apiErrorMessage(createM.error) : null}
                  summary={createEntry.summary({ body: createValues, params: {}, targetName: "", organizationName })}
                />
              ) : null}
            </div>
          ) : (
            <p role="status" className="text-xs text-ink-muted">
              {`Created the dashboard "${created.name}" (${created.slug}). Lay out its widgets below.`}
            </p>
          )}
        </SectionCard>

        <SectionCard title="Widgets">
          {created === null ? (
            <p className="rounded border border-dashed border-line-strong p-4 text-xs text-ink-muted">
              The widgets open here once the dashboard is created.
            </p>
          ) : (
            <div role="region" aria-label="Lay out the widgets">
              {widgetsEntry ? (
                <WizardShell
                  key={created.id}
                  entry={catalogEntry("dashboard.widgets.replace")!}
                  values={widgetsValues}
                  // The rows are the builder's own state; a copilot fill of whole widget payloads is
                  // not mapped back onto them (see the PR 9 notes). The shell marks a fill changed itself.
                  onChange={() => undefined}
                  renderStep={renderLayoutStep}
                  dirty={rows.length > 0}
                  onSubmit={(body) => {
                    // The builder's own rules (a mimic's scope, a missing binding) refuse the save
                    // the shell's parse cannot see; the Review card names why.
                    if (problems.length === 0) widgetsM.mutate(body as PutDashboardWidgetsPayload);
                  }}
                  onCancel={leaveWidgets}
                  submitting={widgetsM.isPending}
                  submitError={
                    problems.length > 0 ? "Fix the problems on the Layout step to save." : widgetsError
                  }
                  summary={widgetsEntry.summary({
                    body: widgetsValues,
                    params: { id: created.id },
                    targetName: created.name,
                    organizationName,
                    currentWidgetIds: created.widgets.map((widget) => widget.id),
                  })}
                />
              ) : null}
            </div>
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}
