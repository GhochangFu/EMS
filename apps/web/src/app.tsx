import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect } from "react";

import { fetchCurrentUser } from "./api/login";
import { AlarmsPage } from "./pages/alarms-page";
import { DashboardPage } from "./pages/dashboard-page";
import { LocationDashboardPage } from "./pages/location-dashboard-page";
import { MapPage } from "./pages/map-page";
import { CracPage } from "./pages/crac-page";
import { EnergyPage } from "./pages/energy-page";
import { SldPage } from "./pages/sld-page";
import { WorkOrdersPage } from "./pages/work-orders-page";
import { MaintenanceSchedulesPage } from "./pages/maintenance-schedules-page";
import { RulesPage } from "./pages/rules-page";
import { ReportsPage } from "./pages/reports-page";
import { ControlRoomOverviewPage } from "./pages/control-room-overview-page";
import { ControlRoomSldPage } from "./pages/control-room-sld-page";
import { ControlRoomItPage } from "./pages/control-room-it-page";
import { ControlRoomUpsPage } from "./pages/control-room-ups-page";
import { ControlRoomBatteryPage } from "./pages/control-room-battery-page";
import { ControlRoomHvacPage } from "./pages/control-room-hvac-page";
import { ControlRoomEnvPage } from "./pages/control-room-env-page";
import { AdminRoute } from "./components/admin-route";
import { AdminHubPage } from "./pages/admin/admin-hub-page";
import { AssetPointsAdminPage } from "./pages/admin/asset-points-page";
import { AssetsAdminPage } from "./pages/admin/assets-page";
import { LocationsAdminPage } from "./pages/admin/locations-page";
import { ManualReadingsPage } from "./pages/admin/manual-readings-page";
import { OrganizationsAdminPage } from "./pages/admin/organizations-page";
import { OnboardingChatPage } from "./pages/admin/onboarding-chat-page";
import { PointKeysAdminPage } from "./pages/admin/point-keys-page";
import { RtusAdminPage } from "./pages/admin/rtus-page";
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
    if (accessToken && isJwtExpired(accessToken)) {
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
          setSession(accessToken, current.user, current.scope);
        }
      })
      .catch(() => {
        if (!cancelled) {
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
      <Route
        path="/"
        element={
          accessToken && user ? (
            <DashboardPage user={user} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/locations/:locationId/dashboard"
        element={
          accessToken && user ? (
            <LocationDashboardPage user={user} />
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
      <Route
        path="/cr-overview"
        element={
          accessToken && user ? (
            <ControlRoomOverviewPage user={user} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/cr-sld"
        element={
          accessToken && user ? (
            <ControlRoomSldPage user={user} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/cr-it"
        element={
          accessToken && user ? (
            <ControlRoomItPage user={user} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/cr-ups"
        element={
          accessToken && user ? (
            <ControlRoomUpsPage user={user} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/cr-battery"
        element={
          accessToken && user ? (
            <ControlRoomBatteryPage user={user} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/cr-hvac"
        element={
          accessToken && user ? (
            <ControlRoomHvacPage user={user} />
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
        path="/cr-env"
        element={
          accessToken && user ? (
            <ControlRoomEnvPage user={user} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
