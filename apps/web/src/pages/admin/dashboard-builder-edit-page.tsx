import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import type { UpdateDashboardBody } from "@bms/shared/contracts";
import { catalogEntry } from "@bms/shared/copilot";

import { adminAssetGroupsQueryKey, fetchAdminAssetGroups } from "../../api/admin/asset-groups";
import { fetchAssets } from "../../api/assets";
import { fetchDashboard, putDashboardWidgets, updateDashboard } from "../../api/dashboards";
import { useDashboardScopeOptions } from "../../hooks/use-dashboard-scope-options";
import { siteWidgetsQueryPrefix } from "../../hooks/use-site-widgets";
import { firstStoredTabKey, useTabMarkers, type TabMarkers } from "../../hooks/use-tab-markers";
import { isMasterDataAdmin } from "../../lib/admin-access";
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
  addBuilderTab,
  blankDashboardWidgetRow,
  buildPutWidgetsPayload,
  moveBuilderTab,
  offerableWidgetTypesOnTab,
  removeBuilderTab,
  renameBuilderTabKey,
  tabLocationMoveProblems,
  tabsHaveChanged,
  tabWritesFromDto,
  builderHasChanged,
  dashboardBuilderErrors,
  dashboardRowsFromDto,
  tabbedDashboardBuilderProblems,
  unselectedDashboardBuilderProblems,
  type BuilderTabsState,
  type DashboardWidgetRow,
  type PutDashboardWidgetsPayload,
  type TabWritePayload,
} from "../../lib/dashboard-builder-form";
import type { WizardStep } from "../../lib/wizard-steps";
import { withDefaultMimicTabKey } from "../../lib/dashboard-builder-mimic-tab";
import { chosenScopeFromFill } from "../../lib/dashboard-scope-fill";
import { metricCatalogLabel } from "../../lib/metric-catalog";
import { WIDGET_CATALOG } from "../../lib/widget-catalog";
import { AppShell } from "../../layouts/app-shell";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { DashboardCanvas, type CanvasTile } from "../../components/dashboards/dashboard-canvas";
import {
  clampScopeToRole,
  DashboardScopeFields,
  type DashboardScopeValue,
} from "../../components/dashboards/dashboard-scope-fields";
import { DashboardTabStrip } from "../../components/dashboards/dashboard-tab-strip";
import { DashboardTabsPanel, type TabGroups } from "../../components/dashboards/dashboard-tabs-panel";
import { DuplicateDashboardDialog } from "../../components/dashboards/duplicate-dashboard-dialog";
import { WidgetInspector } from "../../components/dashboards/widget-inspector";
import { WizardShell } from "../../components/wizard/wizard-shell";
import type { AuthUser } from "../../stores/auth-store";
import type { DashboardDto, SiteWidgetTab, WidgetType } from "@bms/shared";

type DashboardBuilderEditPageProps = {
  user: AuthUser;
};


type WidgetTile = CanvasTile & { row: DashboardWidgetRow; index: number };

/** Review fix (C1) — the details wizard's refusal when the SAVED widgets do not fit the new scope. */
const SAVED_WIDGETS_DO_NOT_FIT_REASON =
  "The saved widgets do not fit this scope. Put the scope back, save the widget changes, then change the scope.";
/** Review fix (C1, PR9-SEC-1) — the widgets wizard's refusal while the scope has unsaved changes. */
const UNSAVED_SCOPE_REASON =
  "The scope has unsaved changes. Save the dashboard details, or put the scope back, before you save the widgets.";

/** `F3.73` critique fix — what a canvas tile binds: its catalog metric(s) when it binds one ("Active
 * alarms metric"), else its point count. A catalog-bound tile used to read "0 point(s)". */
function tileBindingText(row: DashboardWidgetRow): string {
  if (row.sources.length === 0) {
    return `${row.points.length} point(s)`;
  }
  const labels = row.sources.map((source) => metricCatalogLabel(source.catalogKey)).join(", ");
  return `${labels} metric${row.sources.length === 1 ? "" : "s"}`;
}

/**
 * `F3.1d` Unit 7 — edits an existing dashboard's scope, arrangement, config
 * and bindings. **Never touches `organizationId`** — a dashboard's tenant is
 * fixed at creation (`UpdateDashboardBody` carries no such field), so
 * `DashboardScopeFields`'s organization-wide branch is fed a single,
 * already-fixed option rather than a real picker: there is nothing to choose.
 *
 * **`F3.85` PR 9 (ADR 0099 decision 6, plan §11.1) — two wizards on one page.** The
 * dashboard's own fields are the `dashboard.update` wizard (Basics → Scope → Review,
 * `PATCH /dashboards/:id`; Review shows the stored value beside the new one), and the
 * widgets are the `dashboard.widgets.replace` wizard (Layout → Review, `PUT /:id/widgets`
 * with the whole set — preserving every server-issued widget `id` so a re-save does not
 * invent new rows for widgets that already exist; `dashboardRowsFromDto` carries them
 * forward). Each saves on its own, so a widgets-only edit sends no PATCH; a save re-seeds
 * only its own half, so the other wizard's unsaved edits survive it. Each half is judged against
 * the other's STORED half, as the server judges it (see `detailsReason`). The page's own rules
 * (the builder problems, the scope rules, "no changes") refuse a Submit the shell's parse
 * cannot see, and the Review card names why. Neither wizard sends `X-Copilot-Change` — a
 * copilot write goes through the dock's Confirm card only.
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
  // `F3.73` D11 — the edited tab set and the tab the canvas shows. The rows keep `tabKey`, so a
  // re-key or a removal moves the rows in the same update (`BuilderTabsState`).
  const [tabs, setTabs] = useState<readonly TabWritePayload[]>([]);
  const [selectedTabKey, setSelectedTabKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ADR 0047 Amendment 2 ruling 3's duplicate action needs a way in, and this page is it: the
  // ruling reserved the organization-wide dashboard to the two organization-level roles and
  // named copy as the replacement route by which a site admin's good dashboard reaches another
  // plant. A dialog no page renders satisfies none of that, so the entry point is part of the
  // obligation rather than a nicety on top of it.
  const [duplicating, setDuplicating] = useState(false);
  // `F3.85` PR 9 — bumped by a save or a Cancel: that wizard remounts on its first step.
  const [detailsRound, setDetailsRound] = useState(0);
  const [widgetsRound, setWidgetsRound] = useState(0);
  // Which half the next dto re-seeds: both for a newly loaded dashboard, else only the half
  // whose wizard just saved — so a PATCH answer does not wipe unsaved widget edits, nor a PUT
  // answer unsaved name or scope edits.
  const reseed = useRef<{ id: string | null; fields: boolean; widgets: boolean }>({
    id: null,
    fields: true,
    widgets: true,
  });
  // Review fix (C2) — the dashboard the form has been seeded from. The wizards mount only once it
  // is this `dto`: a copilot fill that waited in `useWizardStore` is taken by the shell's mount
  // effect, and a seed in the same commit (parent effects run after the child's) overwrote it.
  const [seededFor, setSeededFor] = useState<string | null>(null);

  function seedFields(from: DashboardDto): void {
    setName(from.name);
    setDescription(from.description ?? "");
    // Four-way (`F3.34`, then `F3.63`): an asset-group dashboard prefills as one, and an
    // asset-scoped row as the read-only `asset` kind. Before `F3.34` the prefill was two-way and
    // a rename silently widened a group dashboard to the tenant. Before `F3.63` an asset-scoped
    // row showed a false organization radio; a rename kept its `assetId` (the two nulls merged
    // onto one axis, so the save succeeded silently) and choosing a location or a group was a
    // 400 (Amendment 6 §Q2).
    setScope(scopeFromDashboard(from));
  }

  function seedWidgets(from: DashboardDto): void {
    setRows(dashboardRowsFromDto(from));
    setSelected(null);
    // The read orders the tabs by `sortOrder`, so the first is the default.
    const storedTabs = tabWritesFromDto(from.tabs);
    setTabs(storedTabs);
    setSelectedTabKey(storedTabs[0]?.key ?? null);
  }

  useEffect(() => {
    if (!dto) {
      return;
    }
    const fresh = reseed.current.id !== dto.id;
    if (fresh || reseed.current.fields) {
      seedFields(dto);
    }
    if (fresh || reseed.current.widgets) {
      seedWidgets(dto);
    }
    reseed.current = { id: dto.id, fields: false, widgets: false };
    setSeededFor(dto.id);
  }, [dto]);

  // `DashboardScopeFields`'s clamp, applied by the page too: the fields mount on the Scope step
  // only, and the reasons below (and the Tabs panel) read the clamped scope from the first render.
  useEffect(() => {
    const clamped = clampScopeToRole(user.role, scope);
    if (clamped !== null) {
      setScope(clamped);
    }
  }, [user.role, scope]);

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

  // `F3.73` D11 — a tab binds one of the groups AT the dashboard's site, so the select reads
  // `GET /admin/asset-groups?locationId=` for the live location: the location-scope branch only
  // (the API refuses a group tab on every other scope), and only once a tab exists to bind.
  const siteLocationId = scope.kind === "location" && scope.locationId !== "" ? scope.locationId : null;
  const tabGroupsQ = useQuery({
    queryKey: adminAssetGroupsQueryKey(siteLocationId ?? undefined),
    queryFn: () => fetchAdminAssetGroups(siteLocationId ?? undefined),
    enabled: siteLocationId !== null && tabs.length > 0 && isMasterDataAdmin(user.role),
  });
  // Review fix — only a read that answered says which groups the site holds. A pending, failed or
  // disabled read is not an empty site: the panel must not call a bound group "at another site".
  const tabGroups: TabGroups | null =
    siteLocationId === null
      ? null
      : tabGroupsQ.data !== undefined
        ? { status: "loaded", items: tabGroupsQ.data.items.map((group) => ({ id: group.id, name: group.name })) }
        : tabGroupsQ.isError
          ? { status: "failed", message: apiErrorMessage(tabGroupsQ.error) }
          : tabGroupsQ.fetchStatus === "fetching"
            ? { status: "loading" }
            : { status: "unavailable" };
  const selectedTab = tabs.find((tab) => tab.key === selectedTabKey);

  // `F3.77` (plan D4) — the tab markers read the STORED tabs (`dto.tabs`, the first by sortOrder),
  // never the edited set, and an edited tab draws one only while it is still the stored tab of
  // that key (same id, same key): an unsaved tab, or a re-keyed one, has none.
  const storedMarkers = useTabMarkers(dto?.id ?? "", dto ? firstStoredTabKey(dto.tabs) : null);
  const markers = useMemo((): TabMarkers => {
    const storedKeyById = new Map((dto?.tabs ?? []).map((tab) => [tab.id, tab.key]));
    const byTab = new Map<string, SiteWidgetTab>();
    for (const tab of tabs) {
      const marker = storedMarkers.byTab.get(tab.key);
      if (marker !== undefined && tab.id !== undefined && storedKeyById.get(tab.id) === tab.key) {
        byTab.set(tab.key, marker);
      }
    }
    return { byTab, severities: storedMarkers.severities };
  }, [dto, tabs, storedMarkers.byTab, storedMarkers.severities]);

  // F3.73 — the edited tabs: the per-tab cap, the tab rules and a mimic on a group-bound tab.
  // A move off the site while a SAVED tab binds a group is refused before Save: the PATCH would meet
  // the tabs' location FK before the PUT could clear the group (`tabLocationMoveProblems`).
  const problems = [
    ...dashboardBuilderErrors(rows, scope.kind, tabs),
    ...(dto ? tabLocationMoveProblems(dto, scopePatch(scope)) : []),
  ];
  // Review finding — `WidgetInspector` (below) renders only the SELECTED widget's problems, so
  // a set-level problem or another widget's problem must surface somewhere else, or `Save`
  // disables with a reason nothing on the page shows.
  const summaryProblems = unselectedDashboardBuilderProblems(problems, selected);
  const fieldsChanged = dto
    ? name !== dto.name || description !== (dto.description ?? "") || scopeChanged(scope, dto)
    : false;
  const widgetsChanged = dto ? builderHasChanged(rows, dto) || tabsHaveChanged(tabs, dto) : false;
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
  // `F3.85` PR 9 — each wizard's own refusal, in the same order: the problems and the two scope
  // reasons hold both (a widget PUT on a scope the role cannot write meets the same 404), and
  // "No changes yet." is judged on that wizard's half alone. `null` lets its Submit send.
  const sharedReason =
    problems.length > 0
      ? "Fix the problems below to save."
      : !isScopeChosen(scope)
        ? "Choose a scope to save."
        : !scopeAuthorised
          ? "This dashboard is scoped to a location or asset group outside your scope, so it cannot be saved here."
          : null;
  //
  // Review fix (C1, PR9-SEC-1) — each write is judged against the STORED other half, because that
  // is what the server judges it against. The PATCH writes the scope beside the SAVED widgets
  // (`DashboardsService.update` never reads them), so a scope change is also checked against the
  // stored rows and tabs: removing a mimic without saving it, then moving off the group, must not
  // PATCH. The PUT writes onto the SAVED scope (`putWidgets` checks a mimic and a group tab against
  // it), so the widgets wizard refuses while the scope has unsaved changes: then the scope it was
  // judged on above (`problems`, `isScopeChosen`, `isScopeAuthorised`) IS the stored one.
  const scopeIsUnsaved = dto ? scopeChanged(scope, dto) : false;
  const savedWidgetsProblems =
    dto && scopeIsUnsaved ? dashboardBuilderErrors(dashboardRowsFromDto(dto), scope.kind, tabWritesFromDto(dto.tabs)) : [];
  const detailsReason = !dto
    ? "Dashboard has not loaded yet"
    : problems.length === 0 && savedWidgetsProblems.length > 0
      ? SAVED_WIDGETS_DO_NOT_FIT_REASON
      : (sharedReason ?? (fieldsChanged ? null : "No changes yet."));
  const widgetsReason = !dto
    ? "Dashboard has not loaded yet"
    : // After the shared reasons: a clamp-rewritten scope (a role on a kind it is not offered) asks
      // to choose a scope, not to "put it back" — the page moved it, not the author.
      (sharedReason ?? (scopeIsUnsaved ? UNSAVED_SCOPE_REASON : widgetsChanged ? null : "No changes yet."));

  // The `dashboard.update` body is the first wizard's values.
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
  // `isScopeAuthorised` in `detailsReason` above that refuses the Submit there, and the 404 the
  // PATCH would otherwise meet is never reached.
  // `slug` is left unset: this page has no slug field, so the body never renames the address.
  const updateValues: Record<string, unknown> = {
    name: name.trim(),
    description: description.trim() === "" ? null : description.trim(),
    ...scopePatch(scope),
  };
  // The stored values the Review card shows beside the new ones.
  const updateCurrent: Record<string, unknown> | null = dto
    ? { name: dto.name, description: dto.description, locationId: dto.locationId, assetGroupId: dto.assetGroupId }
    : null;
  // `F3.73` D11 — the edited tabs, labels trimmed; stored ids kept, so the API's diff keeps them.
  const widgetsValues: Record<string, unknown> = {
    ...buildPutWidgetsPayload(
      rows,
      tabs.map((tab) => ({ ...tab, label: tab.label.trim() })),
    ),
  };

  /** A copilot `fill_step` mapped back onto the typed state: the name, the description and a
   * chosen scope. An asset-scoped row keeps its read-only scope; `slug` has no field here. */
  function applyUpdateValues(next: Record<string, unknown>): void {
    if (typeof next.name === "string") setName(next.name);
    if (typeof next.description === "string" || next.description === null) setDescription(next.description ?? "");
    // Review fix (C3) — the kind is read from the column the fill changed (`chosenScopeFromFill`).
    // The edit wizard's Scope step has no organization field, so the tenant stays the dashboard's.
    setScope((current) =>
      current.kind === "asset"
        ? current
        : chosenScopeFromFill(current, { ...next, organizationId: current.organizationId }),
    );
  }

  /** The answer to either write: the cache takes it, and the tab markers re-read. */
  function stored(next: DashboardDto): void {
    queryClient.setQueryData(["dashboards", "detail", slug, organizationIdParam], next);
    // `F3.77` review fix — the tab markers' read: a rebound group shows its status now, not at the next poll.
    void queryClient.invalidateQueries({ queryKey: [...siteWidgetsQueryPrefix, next.id] });
  }

  const updateM = useMutation({
    // The plain request: a wizard used alone sends no `X-Copilot-Change` header (plan §10.5).
    mutationFn: (body: UpdateDashboardBody) => {
      if (!dto) {
        throw new Error("Dashboard has not loaded yet");
      }
      return updateDashboard(dto.id, body);
    },
    onSuccess: (next) => {
      setError(null);
      reseed.current = { ...reseed.current, fields: true };
      stored(next);
      setDetailsRound((current) => current + 1);
    },
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });

  const widgetsM = useMutation({
    mutationFn: (body: PutDashboardWidgetsPayload) => {
      if (!dto) {
        throw new Error("Dashboard has not loaded yet");
      }
      return putDashboardWidgets(dto.id, body);
    },
    onSuccess: (next) => {
      setError(null);
      reseed.current = { ...reseed.current, widgets: true };
      stored(next);
      setWidgetsRound((current) => current + 1);
    },
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });

  function cancelDetails(): void {
    if (dto) seedFields(dto);
    updateM.reset();
    setDetailsRound((current) => current + 1);
  }

  function cancelWidgets(): void {
    if (dto) seedWidgets(dto);
    widgetsM.reset();
    setWidgetsRound((current) => current + 1);
  }

  function addWidget(widgetType: WidgetType): void {
    // `F3.73` D11 — a new widget lands on the tab the canvas shows.
    const onTab = selectedTabKey !== null && tabs.length > 0 ? { tabKey: selectedTabKey } : {};
    // `F3.74` — a new mimic on a group-less tab resolves through the first group-bound tab.
    const added = withDefaultMimicTabKey({ ...blankDashboardWidgetRow(widgetType), ...onTab }, tabs);
    setRows((current) => {
      const next = [...current, added];
      setSelected(next.length - 1);
      return next;
    });
  }

  function updateWidget(index: number, patch: Partial<DashboardWidgetRow>): void {
    setRows((current) => current.map((row, position) => (position === index ? { ...row, ...patch } : row)));
    // A widget moved to another tab: the canvas follows it, so the author sees where it went.
    if (patch.tabKey !== undefined) {
      setSelectedTabKey(patch.tabKey);
    }
  }

  /** Applies one tab edit to the tabs and the rows together. */
  function applyTabs(next: BuilderTabsState): void {
    setTabs(next.tabs);
    setRows([...next.rows]);
  }

  function selectTab(key: string | null): void {
    setSelectedTabKey(key);
    setSelected(null);
  }

  function addTab(): void {
    const next = addBuilderTab({ tabs, rows });
    applyTabs(next);
    selectTab(next.key);
  }

  function rekeyTab(index: number, key: string): boolean {
    const next = renameBuilderTabKey({ tabs, rows }, index, key);
    if (next === null) {
      return false;
    }
    applyTabs(next);
    if (tabs[index]?.key === selectedTabKey) {
      setSelectedTabKey(key);
    }
    return true;
  }

  function updateTab(index: number, patch: Partial<Pick<TabWritePayload, "label" | "assetGroupId">>): void {
    setTabs((current) => current.map((tab, position) => (position === index ? { ...tab, ...patch } : tab)));
  }

  function removeTab(index: number): void {
    const removed = tabs[index]?.key;
    const next = removeBuilderTab({ tabs, rows }, index);
    applyTabs(next);
    // The rows were re-indexed, so no selection survives a removal.
    if (removed === selectedTabKey) {
      selectTab(next.tabs[0]?.key ?? null);
    } else {
      setSelected(null);
    }
  }

  const widgetCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.tabKey !== undefined) {
      widgetCounts.set(row.tabKey, (widgetCounts.get(row.tabKey) ?? 0) + 1);
    }
  }

  function removeWidget(index: number): void {
    setRows((current) => current.filter((_, position) => position !== index));
    setSelected((current) => (current === index ? null : current));
  }

  // `F3.73` D11 — the selected tab's widgets only. `index` stays the index into the WHOLE
  // `rows` array, which `updateWidget`, `removeWidget` and the inspector's problems key on.
  const tiles: WidgetTile[] = rows.flatMap((row, index) =>
    tabs.length === 0 || row.tabKey === selectedTabKey
      ? [{ key: row.id ?? `new-${index}`, gridX: row.gridX, gridY: row.gridY, gridW: row.gridW, gridH: row.gridH, row, index }]
      : [],
  );

  const selectedRow = selected !== null ? rows[selected] : undefined;

  /** `F3.73` critique fix — opens a summary problem's tab and selects its widget, so the inspector
   * shows the field to fix. */
  function showProblem(tabKey: string, widget: number | null): void {
    selectTab(tabKey);
    setSelected(widget);
  }

  const canvas =
    tiles.length === 0 ? (
      <p className="rounded border border-dashed border-line-strong p-4 text-xs text-ink-muted">
        {tabs.length > 0 ? "Add a widget to this tab." : "Add a widget to start composing this dashboard."}
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
              {WIDGET_CATALOG[tile.row.widgetType].label} · {tileBindingText(tile.row)}
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
    );

  const updateEntry = catalogEntry("dashboard.update");
  const widgetsEntry = catalogEntry("dashboard.widgets.replace");

  /** The `dashboard.update` wizard's two field steps: Basics (name, description) and Scope. */
  function renderDetailsStep(step: WizardStep) {
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
          <label className="block space-y-1 text-xs">
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
        onChange={setScope}
        organizations={dto ? [{ id: dto.organizationId, name: "This dashboard's organization" }] : []}
        locations={locations}
        assetGroups={assetGroups}
        assets={assets}
      />
    );
  }

  /** The `dashboard.widgets.replace` wizard's Layout step: the Tabs panel, the canvas and the inspector. */
  function renderLayoutStep() {
    return (
      <div className="space-y-4">
        <DashboardTabsPanel
          tabs={tabs}
          groups={tabGroups}
          widgetCounts={widgetCounts}
          onAdd={addTab}
          onLabel={(index, label) => updateTab(index, { label })}
          onKey={rekeyTab}
          onGroup={(index, assetGroupId) => updateTab(index, { assetGroupId })}
          onMove={(index, delta) => setTabs(moveBuilderTab(tabs, index, delta))}
          onRemove={removeTab}
        />

        <SectionCard
          title="Widgets"
          actions={
            <div className="flex flex-wrap gap-2">
              {/* `F3.32` — the live scope's kind, so a scope switch removes "Plant mimic" at once;
                  `F3.73` D11 — and the selected tab, so a group-bound tab offers it. */}
              {offerableWidgetTypesOnTab(scope.kind, selectedTab, tabs).map((type) => (
                <button key={type} type="button" onClick={() => addWidget(type)} className="surface-button px-2 py-1">
                  + {WIDGET_CATALOG[type].label}
                </button>
              ))}
            </div>
          }
        >
          {/* `F3.73` critique fix — the strip owns the tabpanel, so the canvas is its child. */}
          {tabs.length > 0 ? (
            <DashboardTabStrip tabs={tabs} selectedKey={selectedTabKey} onSelect={selectTab} markers={markers}>
              {canvas}
            </DashboardTabStrip>
          ) : (
            canvas
          )}
        </SectionCard>

        {selected !== null && selectedRow && dto ? (
          <WidgetInspector
            row={selectedRow}
            role={user.role}
            problems={problems.filter((problem) => problem.widget === selected)}
            organizationId={dto.organizationId}
            tabs={tabs}
            onChange={(patch) => updateWidget(selected, patch)}
            onRemove={() => removeWidget(selected)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <AppShell user={user} kpiRibbon={<span className="text-ink">{dto?.name ?? "Edit dashboard"}</span>}>
      <div className="mx-auto max-w-[1400px] space-y-4 pb-8">
        <PageHeader eyebrow="Admin" title={dto?.name ?? "Edit dashboard"} subtitle={slug} />

        {dashboardQ.isError ? (
          <p className="rounded border border-critical-line bg-critical-wash p-3 text-sm text-critical-ink-strong">
            {apiErrorMessage(dashboardQ.error as Error)}
          </p>
        ) : null}
        {error ? <p className="rounded border border-critical-line bg-critical-wash p-3 text-sm text-critical-ink-strong">{error}</p> : null}

        {dto && seededFor === dto.id ? (
          <>
            <SectionCard title="Dashboard">
              <div role="region" aria-label="Dashboard details">
                {updateEntry ? (
                  <WizardShell
                    key={`details-${detailsRound}`}
                    entry={catalogEntry("dashboard.update")!}
                    values={updateValues}
                    onChange={applyUpdateValues}
                    renderStep={renderDetailsStep}
                    // Review fix (C4) — Cancel discards click-only work too (a scope radio), so it asks first.
                    dirty={fieldsChanged}
                    onSubmit={(body) => {
                      // The page's own rules refuse what the shell's parse cannot see; the card says why.
                      if (detailsReason === null) updateM.mutate(body as UpdateDashboardBody);
                    }}
                    onCancel={cancelDetails}
                    submitting={updateM.isPending}
                    submitError={detailsReason}
                    current={updateCurrent}
                    summary={updateEntry.summary({
                      body: updateValues,
                      params: { id: dto.id },
                      targetName: dto.name,
                      organizationName: "",
                    })}
                  />
                ) : null}
              </div>
              <div className="mt-3 border-t border-well-deep pt-3">
                <button
                  type="button"
                  onClick={() => setDuplicating(true)}
                  className="surface-button px-3 py-1.5"
                >
                  Duplicate this dashboard
                </button>
                <p className="mt-1 text-xs text-ink-muted">
                  Copies this dashboard into a scope you may already write to. The copy stays in this
                  organization.
                </p>
              </div>
            </SectionCard>

            <div role="region" aria-label="Dashboard widgets">
              {widgetsEntry ? (
                <WizardShell
                  key={`widgets-${widgetsRound}`}
                  entry={catalogEntry("dashboard.widgets.replace")!}
                  values={widgetsValues}
                  // The rows are the builder's own state; a copilot fill of whole widget payloads is
                  // not mapped back onto them (see the PR 9 notes). The shell marks a fill changed itself.
                  onChange={() => undefined}
                  renderStep={renderLayoutStep}
                  // Review fix (C4) — the builder's work is mostly clicks (add, drag, remove), so it asks first.
                  dirty={widgetsChanged}
                  onSubmit={(body) => {
                    if (widgetsReason === null) widgetsM.mutate(body as PutDashboardWidgetsPayload);
                  }}
                  onCancel={cancelWidgets}
                  submitting={widgetsM.isPending}
                  submitError={widgetsReason}
                  summary={widgetsEntry.summary({
                    body: widgetsValues,
                    params: { id: dto.id },
                    targetName: dto.name,
                    organizationName: "",
                    currentWidgetIds: dto.widgets.map((widget) => widget.id),
                  })}
                />
              ) : null}
            </div>

            <div className="flex items-start gap-3 border-t border-line pt-3">
              <div className="text-[11px] text-ink-muted">
                <p>{saveReason}</p>
                {summaryProblems.length > 0 ? (
                  <ul className="mt-1 space-y-0.5 text-critical-ink">
                    {/* `F3.73` critique fix — grouped by tab, each tabbed entry named by its tab and
                        a button that opens it: the canvas shows one tab and numbers no tile. */}
                    {tabbedDashboardBuilderProblems(rows, tabs, summaryProblems).map(({ problem, tabKey, subject }, index) => (
                      <li key={index}>
                        {tabKey !== null ? (
                          <button
                            type="button"
                            onClick={() => showProblem(tabKey, problem.widget)}
                            className="rounded font-semibold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                          >
                            {subject}:
                          </button>
                        ) : (
                          <span className="font-semibold">{subject}:</span>
                        )}{" "}
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
