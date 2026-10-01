import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect } from "react";

import { fetchCurrentUser } from "./api/login";
import { rememberWallReturnPath } from "./lib/return-path";
import { AlarmKbPage } from "./pages/alarm-kb-page";
import { AlarmsPage } from "./pages/alarms-page";
import { AssetsPage } from "./pages/assets-page";
import { AttributionsPage } from "./pages/attributions-page";
import { DashboardsPage } from "./pages/dashboards-page";
import { SustainabilityEntryPage } from "./pages/sustainability-entry-page";
import { DashboardViewerPage } from "./pages/dashboard-viewer-page";
import { MapPage } from "./pages/map-page";
import { CracPage } from "./pages/crac-page";
import { EnergyPage } from "./pages/energy-page";
import { SldPage } from "./pages/sld-page";
import { WorkOrdersPage } from "./pages/work-orders-page";
import { MaintenanceSchedulesPage } from "./pages/maintenance-schedules-page";
import { RulesPage } from "./pages/rules-page";
import { ReportsPage } from "./pages/reports-page";
import { ControlRoomOrganizationsPage } from "./pages/control-room/organizations-page";
import { ControlRoomOrganizationPage } from "./pages/control-room/organization-page";
import { ControlRoomSitePage } from "./pages/control-room/site-page";
import { AdminRoute } from "./components/admin-route";
import { ControlRoomScopeRoute } from "./components/control-room-scope-route";
import { LocationDashboardRedirect } from "./components/location-dashboard-redirect";
import { SmocLegacyRedirect } from "./components/smoc-legacy-redirect";
import { DashboardAuthorRoute } from "./components/dashboard-author-route";
import { AdminHubPage } from "./pages/admin/admin-hub-page";
import { AssetPointsAdminPage } from "./pages/admin/asset-points-page";
import { DashboardBuilderEditPage } from "./pages/admin/dashboard-builder-edit-page";
import { DashboardBuilderPage } from "./pages/admin/dashboard-builder-page";
import { AssetTemplateDetailPage } from "./pages/admin/asset-template-detail-page";
import { AssetTemplateStockViewPage } from "./pages/admin/asset-template-stock-view-page";
import { AssetTemplateVersionsPage } from "./pages/admin/asset-template-versions-page";
import { AssetTemplatesAdminPage } from "./pages/admin/asset-templates-page";
import { DashboardTemplateDetailPage } from "./pages/admin/dashboard-template-detail-page";
import { DashboardTemplateStockViewPage } from "./pages/admin/dashboard-template-stock-view-page";
import { DashboardTemplatesAdminPage } from "./pages/admin/dashboard-templates-page";
import { AssetsAdminPage } from "./pages/admin/assets-page";
import { LocationsAdminPage } from "./pages/admin/locations-page";
import { ManualReadingsPage } from "./pages/admin/manual-readings-page";
import { OrganizationsAdminPage } from "./pages/admin/organizations-page";
import { EscalationProfilesPage } from "./pages/admin/escalation-profiles-page";
import { NotificationChannelsPage } from "./pages/admin/notification-channels-page";
import { NotificationDeliveriesPage } from "./pages/admin/notification-deliveries-page";
import { OnboardingChatPage } from "./pages/admin/onboarding-chat-page";
import { AssetGroupsAdminPage } from "./pages/admin/asset-groups-page";
import { CalcParametersAdminPage } from "./pages/admin/calc-parameters-page";
import { LocationTypesAdminPage } from "./pages/admin/location-types-page";
import { MimicLayoutEditorPage } from "./pages/admin/mimic-layout-editor-page";
import { MimicLayoutsPage } from "./pages/admin/mimic-layouts-page";
import { MimicSymbolLibrariesPage } from "./pages/admin/mimic-symbol-libraries-page";
import { PointKeysAdminPage } from "./pages/admin/point-keys-page";
import { RtusAdminPage } from "./pages/admin/rtus-page";
import { TelemetryImportPage } from "./pages/admin/telemetry-import-page";
import { AuthCallbackPage } from "./pages/auth-callback-page";
import { LoginPage } from "./pages/login-page";
import { useAuthStore } from "./stores/auth-store";

function isJwtExpired(token: string): boolean {
  const [, payload] = token.split(".");
  if (!payload) {
    return true;
  }
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(atob(normalized)) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("exp" in parsed) ||
      typeof parsed.exp !== "number"
    ) {
      return true;
    }
    return Date.now() >= parsed.exp * 1000;
  } catch {
    return true;
  }
}

export function App() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const scope = useAuthStore((s) => s.scope);
  const clearSession = useAuthStore((s) => s.clearSession);
  const setSession = useAuthStore((s) => s.setSession);

  useEffect(() => {
    // `F3.77` (plan D10) — a wall tab reloaded with a dead session keeps its wall URL across the
    // sign-in, as a 401 does (`clearSessionOnAuthFailure`); a non-wall URL stores nothing.
    if (accessToken && isJwtExpired(accessToken)) {
      rememberWallReturnPath(window.location);
      clearSession();
    }
  }, [accessToken, clearSession]);

  useEffect(() => {
    if (!accessToken || scope) {
      return;
    }
    let cancelled = false;
    fetchCurrentUser(accessToken)
      .then((current) => {
        if (!cancelled) {
          // Keep the stored OIDC id token: logout sends it as
          // `id_token_hint`, and this re-set must not erase it (F4.156).
          setSession(
            accessToken,
            current.user,
            current.scope,
            useAuthStore.getState().oidcIdToken,
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          rememberWallReturnPath(window.location);
          clearSession();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, clearSession, scope, setSession]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      {/* `F3.72` (ADR 0087, plan D1, OQ2) — `/` renders the caller's Control
          Room entry level in place; the URL stays `/`. Not wrapped in
          `ControlRoomScopeRoute`: that guard sends a `none` scope to `/`, so it
          would loop. The page shows a `none` scope the no-sites card itself.
          `tests/f3.72-control-room-entry.test.ts` keeps that shape. */}
      <Route
        path="/"
        element={
          accessToken && user ? (
            <ControlRoomOrganizationsPage user={user} entry />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      {/* `F3.72` (ADR 0087, plan D5) — the old location dashboard address
          redirects to the site's Assets & RTUs tab, where its body moved;
          behind the same guard as the site route.
          `tests/f3.72-control-room-entry.test.ts` E4 keeps that shape. */}
      <Route
        path="/locations/:locationId/dashboard"
        element={
          accessToken && user ? (
            <ControlRoomScopeRoute>
              <LocationDashboardRedirect />
            </ControlRoomScopeRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/alarms"
        element={
          accessToken && user ? (
            <AlarmsPage user={user} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      {/*
        `E2.2` / ADR 0059 ruling Q0b — a plain authenticated route, NOT an
        `AdminRoute`. Anyone who can see alarms may read the philosophy behind
        them, `viewer` included; the master-data gate on the template authoring
        screen is exactly why the operator and the technician could not before.
        `tests/e2.2-alarm-kb-route-gate.test.ts` holds the API half of that.
      */}
      <Route
        path="/alarm-kb"
        element={
          accessToken && user ? (
            <AlarmKbPage user={user} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      {/* ADR 0086 decision 8 — every signed-in user */}
      <Route
        path="/attributions"
        element={
          accessToken && user ? (
            <AttributionsPage user={user} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/dashboards"
        element={
          accessToken && user ? (
            <DashboardsPage user={user} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      {/* `E4.2` / ADR 0072 decision 1 — the Sustainability sidebar entry. It
          redirects; the same auth guard as /dashboards, because it reads the
          same list. */}
      <Route
        path="/sustainability"
        element={
          accessToken && user ? (
            <SustainabilityEntryPage user={user} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/dashboards/:slug"
        element={
          accessToken && user ? (
            <DashboardViewerPage user={user} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/asset-browser"
        element={
          accessToken && user ? (
            <AssetsPage user={user} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/map"
        element={
          accessToken && user ? (
            <MapPage user={user} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/sld"
        element={
          accessToken && user ? (
            <SldPage user={user} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/crac"
        element={
          accessToken && user ? (
            <CracPage user={user} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/energy"
        element={
          accessToken && user ? (
            <EnergyPage user={user} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/work-orders"
        element={
          accessToken && user ? (
            <WorkOrdersPage user={user} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/maintenance-schedules"
        element={
          accessToken && user ? (
            <MaintenanceSchedulesPage user={user} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/rules"
        element={
          accessToken && user ? (
            <RulesPage user={user} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/reports"
        element={
          accessToken && user ? (
            <ReportsPage user={user} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      {/* `F3.66` — the Control Room shell's three levels; `ControlRoomScopeRoute`
          (D3) is the access guard. `F3.70` — the site route takes an optional
          `:tab` segment (the seven SMOC tabs, D2), and the seven legacy
          `/cr-*` routes redirect into it through `SmocLegacyRedirect` (D6),
          behind the same guard. `tests/f3.70-smoc-site-view.test.ts` keeps
          that shape. */}
      <Route
        path="/control-room"
        element={
          accessToken && user ? (
            <ControlRoomScopeRoute>
              <ControlRoomOrganizationsPage user={user} />
            </ControlRoomScopeRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/control-room/org/:organizationId"
        element={
          accessToken && user ? (
            <ControlRoomScopeRoute>
              <ControlRoomOrganizationPage user={user} />
            </ControlRoomScopeRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/control-room/site/:locationId/:tab?"
        element={
          accessToken && user ? (
            <ControlRoomScopeRoute>
              <ControlRoomSitePage user={user} />
            </ControlRoomScopeRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/cr-overview"
        element={
          accessToken && user ? (
            <ControlRoomScopeRoute>
              <SmocLegacyRedirect tab="overview" />
            </ControlRoomScopeRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/cr-sld"
        element={
          accessToken && user ? (
            <ControlRoomScopeRoute>
              <SmocLegacyRedirect tab="sld" />
            </ControlRoomScopeRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/cr-it"
        element={
          accessToken && user ? (
            <ControlRoomScopeRoute>
              <SmocLegacyRedirect tab="it" />
            </ControlRoomScopeRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/cr-ups"
        element={
          accessToken && user ? (
            <ControlRoomScopeRoute>
              <SmocLegacyRedirect tab="ups" />
            </ControlRoomScopeRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/cr-battery"
        element={
          accessToken && user ? (
            <ControlRoomScopeRoute>
              <SmocLegacyRedirect tab="battery" />
            </ControlRoomScopeRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/cr-hvac"
        element={
          accessToken && user ? (
            <ControlRoomScopeRoute>
              <SmocLegacyRedirect tab="hvac" />
            </ControlRoomScopeRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <AdminHubPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/organizations"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <OrganizationsAdminPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/organizations/:orgId/onboarding"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <OnboardingChatPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/organizations/:orgId/locations"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <LocationsAdminPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/locations"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <LocationsAdminPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/locations/:locationId/rtus"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <RtusAdminPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/locations/:locationId/rtus/:rtuId/assets"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <AssetsAdminPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/notification-channels"
        element={
          accessToken && user ? (
            <AdminRoute user={user} requireNotificationAdmin>
              <NotificationChannelsPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/notification-deliveries"
        element={
          accessToken && user ? (
            <AdminRoute user={user} requireNotificationAdmin>
              <NotificationDeliveriesPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      {/* `F3.10` (ADR 0057 decision 11). Gated exactly as the two `F3.8`
          screens beside it: `EscalationProfilesService` runs on
          `canManageNotificationChannel` (plan ruling Q6), so a `location_admin`
          reaching this URL would get an empty list that reads as "no profiles"
          rather than as a refusal. `tests/e7.1d-notification-route-gate.test.ts`
          is what keeps the prop here. */}
      <Route
        path="/admin/escalation-profiles"
        element={
          accessToken && user ? (
            <AdminRoute user={user} requireNotificationAdmin>
              <EscalationProfilesPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/rtus"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <RtusAdminPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/assets"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <AssetsAdminPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/assets/:assetId/points"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <AssetPointsAdminPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/asset-templates"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <AssetTemplatesAdminPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/asset-templates/:templateId"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <AssetTemplateDetailPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      {/* `F2.14` — declared BEFORE `/admin/asset-templates/:templateId/versions`,
          and the order is load-bearing: both paths are four segments with one
          static and one dynamic part, so a URL matching both resolves by
          declaration order. `asset-templates.controller.ts` carries the same
          rule one layer up (`@Get("stock")` before `@Get(":id")`).
          `tests/f2.14-stock-viewer-reachable.test.ts` checks it. */}
      <Route
        path="/admin/asset-templates/stock/:code"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <AssetTemplateStockViewPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/asset-templates/:templateId/versions"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <AssetTemplateVersionsPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/dashboard-templates"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <DashboardTemplatesAdminPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/dashboard-templates/:templateId"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <DashboardTemplateDetailPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      {/*
        F3.44 — the read-only stock viewer. Four segments against the
        three-segment `:templateId` sibling above, so React Router ranks them
        apart and the F2.14 ordering trap does not exist here today. The rule
        for the future: any four-segment
        `/admin/dashboard-templates/:templateId/<x>` route added later is
        declared AFTER this one; `tests/f3.44-stock-dashboard-view-reachable`
        checks it. `AdminRoute` and not `mayAuthor`: every master-data role may
        read the stock list (plan §5.4).
      */}
      <Route
        path="/admin/dashboard-templates/stock/:code"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <DashboardTemplateStockViewPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/asset-points"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <AssetPointsAdminPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/manual-readings"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <ManualReadingsPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/asset-groups"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <AssetGroupsAdminPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/point-keys"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <PointKeysAdminPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/location-types"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <LocationTypesAdminPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      {/* `F3.32c` (ADR 0081 decision 3) — each page fails closed for a role that cannot draw. */}
      <Route
        path="/admin/mimic-layouts"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <MimicLayoutsPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/mimic-layouts/new"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <MimicLayoutEditorPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/mimic-layouts/:layoutId"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <MimicLayoutEditorPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      {/* `F3.32f` slice 3 (ADR 0086 decisions 4 and 7) — the page fails closed for a role that cannot manage libraries. */}
      <Route
        path="/admin/mimic-symbol-libraries"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <MimicSymbolLibrariesPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/calc-parameters"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <CalcParametersAdminPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/dashboards"
        element={
          accessToken && user ? (
            <DashboardAuthorRoute user={user}>
              <DashboardBuilderPage user={user} />
            </DashboardAuthorRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/dashboards/:slug"
        element={
          accessToken && user ? (
            <DashboardAuthorRoute user={user}>
              <DashboardBuilderEditPage user={user} />
            </DashboardAuthorRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin/telemetry/import"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <TelemetryImportPage user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/cr-env"
        element={
          accessToken && user ? (
            <ControlRoomScopeRoute>
              <SmocLegacyRedirect tab="env" />
            </ControlRoomScopeRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
