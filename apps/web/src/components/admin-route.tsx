import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import type { AuthUser } from "../stores/auth-store";
import { defaultAdminRoute, isGlobalAdmin, isMasterDataAdmin } from "../lib/admin-access";

type AdminRouteProps = {
  user: AuthUser;
  requireGlobalAdmin?: boolean;
  children: ReactNode;
};

/** Guards admin routes by role. */
export function AdminRoute({
  user,
  requireGlobalAdmin = false,
  children,
}: AdminRouteProps) {
  if (!isMasterDataAdmin(user.role)) {
    return <Navigate to="/" replace />;
  }
  if (requireGlobalAdmin && !isGlobalAdmin(user.role)) {
    return <Navigate to={defaultAdminRoute(user.role)} replace />;
  }
  return children;
}
