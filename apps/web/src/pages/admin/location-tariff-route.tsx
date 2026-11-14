import { Navigate } from "react-router-dom";

import { AdminRoute } from "../../components/admin-route";
import { useAuthStore } from "../../stores/auth-store";
import { LocationTariffAdminPage } from "./location-tariff-page";

/**
 * `F4.365` U10 (ADR 0134 decision 3) — the `/admin/locations/:locationId/tariff` route element:
 * signed out goes to login, signed in goes through `AdminRoute`. Its own file under AGENTS.md
 * §4.2 (one exported component per file), the `service-accounts-route.tsx` pattern;
 * `extra-admin-routes.tsx` mounts it (`app.tsx` sits at the §4.5 cap).
 */
export function LocationTariffRoute() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  if (!accessToken || !user) {
    return <Navigate to="/login" replace />;
  }
  return (
    <AdminRoute user={user}>
      <LocationTariffAdminPage user={user} />
    </AdminRoute>
  );
}
