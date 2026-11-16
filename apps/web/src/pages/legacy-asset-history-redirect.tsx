import { Navigate, useLocation, useParams } from "react-router-dom";

import { assetHistoryPath } from "../lib/asset-history-range";

/**
 * `/assets/:assetId/history` (F4.297 first path) → `/asset-history/:assetId`, query kept. Moved
 * out of `app.tsx` (at the AGENTS.md section 4.5 cap) by `E1.4b`; the route line itself stays in
 * `app.tsx` (plan §16 B5), where `tests/f4.297-no-spa-route-under-static-prefix.test.ts` reads it.
 * The id now goes through `assetHistoryPath`, which encodes it: `useParams` decodes `%2F`, so an
 * unencoded `..%2Fadmin` used to land on `/admin` (PR 3 security review; same-site, every target
 * keeps its own guard).
 */
export function LegacyAssetHistoryRedirect() {
  const { assetId = "" } = useParams();
  const { search } = useLocation();
  return <Navigate to={`${assetHistoryPath(assetId)}${search}`} replace />;
}
