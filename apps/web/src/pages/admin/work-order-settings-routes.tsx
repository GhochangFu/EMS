import { Navigate, Route, Routes } from "react-router-dom";

import { AdminRoute } from "../../components/admin-route";
import { useAuthStore } from "../../stores/auth-store";
import { AssetDomainsAdminPage } from "./asset-domains-page";
import { WorkOrderChecklistTemplatesAdminPage } from "./work-order-checklist-templates-page";
import { WorkOrderSlaPoliciesAdminPage } from "./work-order-sla-policies-page";

/**
 * `E3.1` (ADR 0122 decisions 2.4, 3.2 and 4.2; plan T7.3) — the three
 * `/admin/work-order-settings/*` routes: a domain's work-order prefix, the
 * organization's SLA policy, and its checklist templates.
 *
 * Signed out goes to login; signed in, each page sits inside `AdminRoute` and then
 * fails closed on its own role check. One nested `<Routes>`, mounted by
 * `extra-admin-routes.tsx` under `/admin/work-order-settings/*`.
 */
export function WorkOrderSettingsRoutes() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  if (!accessToken || !user) {
    return <Navigate to="/login" replace />;
  }
  return (
    <Routes>
      <Route
        path="asset-domains"
        element={
          <AdminRoute user={user}>
            <AssetDomainsAdminPage user={user} />
          </AdminRoute>
        }
      />
      <Route
        path="sla-policies"
        element={
          <AdminRoute user={user}>
            <WorkOrderSlaPoliciesAdminPage user={user} />
          </AdminRoute>
        }
      />
      <Route
        path="checklist-templates"
        element={
          <AdminRoute user={user}>
            <WorkOrderChecklistTemplatesAdminPage user={user} />
          </AdminRoute>
        }
      />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
