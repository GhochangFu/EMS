import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useAuthStore } from "../stores/auth-store";

/**
 * `F3.66` U2, plan decision D3 — guards the three `/control-room*` routes.
 *
 * The API is the access control (the resolve read answers 404 off-scope,
 * `fetchAssets`/`fetchLocationKpis` intersect with the caller's readable
 * set); this guard only keeps a `none` scope off the shell entirely, and
 * holds the screen while the scope is still loading rather than bouncing a
 * legitimate caller off a cold load — the same reasoning as
 * `ControlRoomRoute` (`F4.156`), without that guard's per-area
 * `canAccessControlRoomPath` check, which does not apply to these routes.
 */
export function ControlRoomScopeRoute({ children }: { children: ReactNode }) {
  const scope = useAuthStore((s) => s.scope);
  if (scope === null) {
    return <p role="status">Checking Control Room access…</p>;
  }
  if (scope.kind === "none") {
    return <Navigate to="/" replace />;
  }
  return children;
}
