import { Navigate } from "react-router-dom";

import { AdminRoute } from "../../components/admin-route";
import { useAuthStore } from "../../stores/auth-store";
import { DeviceProfilesAdminPage } from "./device-profiles-page";

/**
 * `F1.2` (ADR 0141 decision 13, plan T6.1) — the `/admin/device-profiles` route element: signed
 * out goes to login, signed in goes through `AdminRoute`, and the page fails closed for a role
 * without `canManageDeviceProfiles`. Its own file under AGENTS.md §4.2 (one exported component
 * per file), the `tariffs-route.tsx` pattern; `extra-admin-routes.tsx` mounts it (`app.tsx` sits
 * at the §4.5 cap).
 */
export function DeviceProfilesRoute() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  if (!accessToken || !user) {
    return <Navigate to="/login" replace />;
  }
  return (
    <AdminRoute user={user}>
      <DeviceProfilesAdminPage user={user} />
    </AdminRoute>
  );
}
