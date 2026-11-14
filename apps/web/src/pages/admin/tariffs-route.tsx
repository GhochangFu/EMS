import { Navigate } from "react-router-dom";

import { AdminRoute } from "../../components/admin-route";
import { useAuthStore } from "../../stores/auth-store";
import { TariffsAdminPage } from "./tariffs-page";

/**
 * `F4.365` U9 (ADR 0134 decision 8) — the `/admin/tariffs` route element: signed out goes to
 * login, signed in goes through `AdminRoute`. Its own file under AGENTS.md §4.2 (one exported
 * component per file), the `service-accounts-route.tsx` pattern; `extra-admin-routes.tsx` mounts
 * it (`app.tsx` sits at the §4.5 cap).
 */
export function TariffsRoute() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  if (!accessToken || !user) {
    return <Navigate to="/login" replace />;
  }
  return (
    <AdminRoute user={user}>
      <TariffsAdminPage user={user} />
    </AdminRoute>
  );
}
