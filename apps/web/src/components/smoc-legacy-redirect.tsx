import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";

import { fetchLocationKpis } from "../api/locations";
import { findSmocSite, smocTabPath, type SmocTabKey } from "../lib/smoc-pages";

/**
 * `F3.70` (D6, D7, OQ3, OQ4) — the element behind each of the seven legacy
 * `/cr-*` routes. It finds `RSMOC-WC` by `code` in the caller's readable KPI
 * list (the same `["dashboard", "locations"]` read the Control Room levels
 * use) and sends the caller to that site's `tab`. A list without it, or a
 * failed read, sends the caller to `/control-room`, which level-skips into
 * their own organization; this never names a site the caller cannot read.
 *
 * It decides from `data`, never from `status` (D6): while the read has no
 * data it renders a status line and does not navigate. `ControlRoomScopeRoute`
 * wraps it in `app.tsx`, so a caller with no Control Room scope never reaches
 * this read.
 */
export function SmocLegacyRedirect({ tab }: { tab: SmocTabKey }) {
  const { data, isError } = useQuery({
    queryKey: ["dashboard", "locations"],
    queryFn: fetchLocationKpis,
  });

  if (data === undefined) {
    if (isError) {
      return <Navigate to="/control-room" replace />;
    }
    return <p role="status">Opening the Control Room…</p>;
  }

  const site = findSmocSite(data.items);
  if (!site) {
    return <Navigate to="/control-room" replace />;
  }
  return <Navigate to={smocTabPath(site.id, tab)} replace />;
}
