import { Navigate } from "react-router-dom";

import { useAuthStore } from "../stores/auth-store";
import { ForecastsPage } from "./forecasts-page";

/**
 * `E1.4b` (ADR 0135 Amendment 3 R-e) — the `/forecasts` route element: signed out goes to login,
 * signed in sees the page. No role gate: every signed-in user sees the item, and the API filters
 * the rows by access. Its own file (plan §16 N7, the `ServiceAccountsRoute` shape without
 * `AdminRoute`) so `extra-routes.tsx` holds only the route list.
 */
export function ForecastsRoute() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  if (!accessToken || !user) {
    return <Navigate to="/login" replace />;
  }
  return <ForecastsPage user={user} />;
}
