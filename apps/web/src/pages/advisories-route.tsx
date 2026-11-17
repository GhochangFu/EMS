import { Navigate } from "react-router-dom";

import { useAuthStore } from "../stores/auth-store";
import { AdvisoriesPage } from "./advisories-page";

/**
 * `E1.6b` / ADR 0137 (plan T2.3) — the `/advisories` route element: signed out goes to login,
 * signed in sees the page. No role gate: every signed-in user sees the item, and the API filters
 * the advisories by access. The `AnomaliesRoute` shape, so `extra-routes.tsx` holds only the
 * route list.
 */
export function AdvisoriesRoute() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  if (!accessToken || !user) {
    return <Navigate to="/login" replace />;
  }
  return <AdvisoriesPage user={user} />;
}
