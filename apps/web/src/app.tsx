import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect } from "react";

import { AlarmsPage } from "./pages/alarms-page";
import { DashboardPage } from "./pages/dashboard-page";
import { MapPage } from "./pages/map-page";
import { CracPage } from "./pages/crac-page";
import { EnergyPage } from "./pages/energy-page";
import { SldPage } from "./pages/sld-page";
import { WorkOrdersPage } from "./pages/work-orders-page";
import { MaintenanceSchedulesPage } from "./pages/maintenance-schedules-page";
import { RulesPage } from "./pages/rules-page";
import { ReportsPage } from "./pages/reports-page";
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
  const clearSession = useAuthStore((s) => s.clearSession);

  useEffect(() => {
    if (accessToken && isJwtExpired(accessToken)) {
      clearSession();
    }
  }, [accessToken, clearSession]);

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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
