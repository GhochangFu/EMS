import { Navigate } from "react-router-dom";

import { AdminRoute } from "../../components/admin-route";
import { useAuthStore } from "../../stores/auth-store";
import { ServiceAccountsAdminPage } from "./service-accounts-page";

/**
 * `F4.17` (ADR 0125 decision 14) — the `/admin/service-accounts` route element: signed out goes to
 * login, signed in goes through `AdminRoute`, and the page fails closed below organization admin.
 * Its own file so `app.tsx` stays under the AGENTS.md §4.5 cap; `extra-admin-routes.tsx` mounts it.
 */
export function ServiceAccountsRoute() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  if (!accessToken || !user) {
    return <Navigate to="/login" replace />;
  }
  return (
    <AdminRoute user={user}>
      <ServiceAccountsAdminPage user={user} />
    </AdminRoute>
  );
}
