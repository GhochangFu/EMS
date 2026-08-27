import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import type { AuthUser } from "../stores/auth-store";
import {
  canManageNotificationChannels,
  defaultAdminRoute,
  isGlobalAdmin,
  isMasterDataAdmin,
} from "../lib/admin-access";

type AdminRouteProps = {
  user: AuthUser;
  requireGlobalAdmin?: boolean;
  /**
   * `E7.1d`. Narrows the route to the roles that may administer notification
   * channels — `admin` and `organization_admin`.
   *
   * `isMasterDataAdmin` admits `location_admin`, and `ChannelsService.list`
   * returns `[]` for that role unconditionally. Without this the route stays
   * reachable by URL and renders a page whose empty table is indistinguishable
   * from an organization that has configured no channels: the screen would say
   * "no channels yet" to somebody who is not permitted to see any.
   */
  requireNotificationAdmin?: boolean;
  children: ReactNode;
};

/** Guards admin routes by role. */
export function AdminRoute({
  user,
  requireGlobalAdmin = false,
  requireNotificationAdmin = false,
  children,
}: AdminRouteProps) {
  if (!isMasterDataAdmin(user.role)) {
    return <Navigate to="/" replace />;
  }
  if (requireGlobalAdmin && !isGlobalAdmin(user.role)) {
    return <Navigate to={defaultAdminRoute(user.role)} replace />;
  }
  if (requireNotificationAdmin && !canManageNotificationChannels(user.role)) {
    return <Navigate to={defaultAdminRoute(user.role)} replace />;
  }
  return children;
}
