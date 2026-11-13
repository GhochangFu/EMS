import { Route } from "react-router-dom";

import { MaintenanceWindowsRoute } from "./maintenance-windows-page";
import { ServiceAccountsRoute } from "./service-accounts-route";
import { WorkOrderSettingsRoutes } from "./work-order-settings-routes";

/**
 * Admin routes declared outside `app.tsx`, which sits at the AGENTS.md section 4.5 cap:
 * `app.tsx` renders this fragment inside its `<Routes>` and takes one line for all of them.
 * A new admin route whose element lives in its own file goes here, not in `app.tsx`.
 *
 * - `F4.17` (ADR 0125 decision 14): `/admin/service-accounts`.
 * - `E3.1` (ADR 0122 decisions 2.4, 3.2 and 4.2): `/admin/work-order-settings/*`, three
 *   nested routes (`work-order-settings-routes.tsx`).
 * - `F4.359` U15 (ADR 0131 decision 16): `/admin/maintenance-windows` (`AdminRoute` in
 *   `maintenance-windows-page.tsx`).
 */
export const EXTRA_ADMIN_ROUTES = (
  <>
    <Route path="/admin/service-accounts" element={<ServiceAccountsRoute />} />
    <Route path="/admin/work-order-settings/*" element={<WorkOrderSettingsRoutes />} />
    <Route path="/admin/maintenance-windows" element={<MaintenanceWindowsRoute />} />
  </>
);
