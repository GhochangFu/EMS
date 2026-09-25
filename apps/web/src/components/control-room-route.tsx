import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useControlRoomAccess } from "../hooks/use-control-room-access";
import { canAccessControlRoomPath } from "../lib/control-room-access";
import { useAuthStore } from "../stores/auth-store";

/**
 * `F4.156` — guards the seven `/cr-*` routes.
 *
 * A caller who reads no `CR-*` asset is sent to `/`, as is a caller whose
 * `asset_group` scope does not cover the route's area. While the assets read
 * is pending the guard renders a status line rather than redirecting: on a
 * hard reload the persisted session restores before the read resolves, and a
 * redirect then would bounce every legitimate user off a cold `/cr-*` load.
 */
export function ControlRoomRoute({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const scope = useAuthStore((s) => s.scope);
  const access = useControlRoomAccess();
  if (access === "pending") {
    return <p role="status">Checking Control Room access…</p>;
  }
  if (access === "denied" || !canAccessControlRoomPath(scope, pathname)) {
    return <Navigate to="/" replace />;
  }
  return children;
}
