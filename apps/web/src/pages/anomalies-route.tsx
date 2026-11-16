import { Navigate } from "react-router-dom";

import { useAuthStore } from "../stores/auth-store";
import { AnomaliesPage } from "./anomalies-page";

/**
 * `E1.2c` (ADR 0135 Amendment 5 ruling 4(a)) — the `/anomalies` route element: signed out goes to
 * login, signed in sees the page. No role gate: every signed-in user sees the item, and the API
 * filters the rows by access. The `ForecastsRoute` shape, so `extra-routes.tsx` holds only the
 * route list.
 */
export function AnomaliesRoute() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  if (!accessToken || !user) {
    return <Navigate to="/login" replace />;
  }
  return <AnomaliesPage user={user} />;
}
