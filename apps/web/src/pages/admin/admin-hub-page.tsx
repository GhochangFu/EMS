import { Navigate } from "react-router-dom";

import { defaultAdminRoute } from "../../lib/admin-access";
import type { AuthUser } from "../../stores/auth-store";

type AdminHubPageProps = {
  user: AuthUser;
};

/** Redirects the master data hub entry to the role default drill-down route. */
export function AdminHubPage({ user }: AdminHubPageProps) {
  return <Navigate to={defaultAdminRoute(user.role)} replace />;
}
