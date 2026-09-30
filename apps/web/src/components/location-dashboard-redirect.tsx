import { Navigate, useParams } from "react-router-dom";

import { siteAssetsPath } from "../lib/smoc-pages";

/**
 * `F3.72` (ADR 0087, plan D5) — the element behind the old
 * `/locations/:locationId/dashboard` address. The location dashboard's body
 * moved to the site page's Assets & RTUs tab (`SiteAssetsView`), so a saved
 * link or bookmark lands there, replacing the history entry. It reads
 * nothing: `ControlRoomScopeRoute` wraps it in `app.tsx`, and the site page
 * decides whether the caller can read the site (the not-available card).
 */
export function LocationDashboardRedirect() {
  const { locationId = "" } = useParams();
  return <Navigate to={siteAssetsPath(locationId)} replace />;
}
