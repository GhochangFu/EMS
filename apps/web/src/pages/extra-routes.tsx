import { Route } from "react-router-dom";

import { AdvisoriesRoute } from "./advisories-route";
import { AnomaliesRoute } from "./anomalies-route";
import { ForecastsRoute } from "./forecasts-route";

/**
 * Signed-in routes declared outside `app.tsx`, which sits at the AGENTS.md section 4.5 cap:
 * `app.tsx` renders this fragment inside its `<Routes>` and takes one line for all of them, the
 * `pages/admin/extra-admin-routes.tsx` shape for routes that are not admin. A new route whose
 * element lives in its own file goes here, not in `app.tsx`. Never a path under `/assets/` —
 * that is nginx's static prefix (`tests/f4.297-no-spa-route-under-static-prefix.test.ts`).
 *
 * - `E1.4b` (ADR 0135 Amendment 3 R-e): `/forecasts` (`forecasts-route.tsx`).
 * - `E1.2c` (ADR 0135 Amendment 5 ruling 4(a)): `/anomalies` (`anomalies-route.tsx`).
 * - `E1.6b` (ADR 0137): `/advisories` (`advisories-route.tsx`).
 */
export const EXTRA_ROUTES = (
  <>
    <Route path="/forecasts" element={<ForecastsRoute />} />
    <Route path="/anomalies" element={<AnomaliesRoute />} />
    <Route path="/advisories" element={<AdvisoriesRoute />} />
  </>
);
