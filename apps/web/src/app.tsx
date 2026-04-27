import { Navigate, Route, Routes } from "react-router-dom";

import { AlarmsPage } from "./pages/alarms-page";
import { DashboardPage } from "./pages/dashboard-page";
import { MapPage } from "./pages/map-page";
import { CracPage } from "./pages/crac-page";
import { EnergyPage } from "./pages/energy-page";
import { SldPage } from "./pages/sld-page";
import { LoginPage } from "./pages/login-page";
import { useAuthStore } from "./stores/auth-store";

export function App() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
