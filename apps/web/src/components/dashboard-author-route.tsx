import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import type { AuthUser } from "../stores/auth-store";
import { canAuthorDashboards } from "../lib/admin-access";

type DashboardAuthorRouteProps = {
  user: AuthUser;
  children: ReactNode;
};

/**
 * `F3.63`, ADR 0047 Amendment 6 §Q1 point 1 — guards the two dashboard builder
 * routes on `canAuthorDashboards`, the web mirror of
 * `canPerformOperationsWrite(role, "configuration")`, which is
 * `DashboardBuilderController`'s own gate on `create`/`update`/`remove`/`putWidgets`
 * (`operations-write.ts`).
 *
 * **Not `AdminRoute`.** `AdminRoute` guards on `isMasterDataAdmin` — the roles
 * that administer master data (organizations, locations, asset groups,
 * asset points). Authoring a dashboard is not master-data administration: the
 * API's own gate for it is the operations-write predicate above, which already
 * admits `asset_group_admin`. Wrapping the builder routes in `AdminRoute`
 * refused that role a screen the API was willing to serve it — this route
 * exists so the two match.
 */
export function DashboardAuthorRoute({ user, children }: DashboardAuthorRouteProps) {
  if (!canAuthorDashboards(user.role)) {
    return <Navigate to="/" replace />;
  }
  return children;
}
