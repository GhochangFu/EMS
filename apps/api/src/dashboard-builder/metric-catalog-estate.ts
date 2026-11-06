import { sql } from "drizzle-orm";

import { latestPueRatio } from "../telemetry/pue-ratio";
import { REPORTING_ASSETS_CTE_SQL } from "../telemetry/telemetry-freshness";
import type { Resolver } from "./metric-catalog-types";

/**
 * `F4.317` (ADR 0112 decisions 7 and 9) — the two catalog entries the organization KPI strip
 * takes from the estate strip: "Sites live" and PUE. In their own file because
 * `metric-catalog.service.ts` sits near AGENTS.md §4.5's cap; `RESOLVERS` names both.
 *
 * Both take the resolved scope — the organization-bounded asset ids `resolveAssetScope`
 * produced, intersected with the caller's readable set — and an empty scope answers before any
 * SQL, as every entry does (`metric-catalog.service.spec.ts` enumerates them).
 */

/**
 * `sites.live.count` — decision 7: **a site is a location.** The locations in scope with at
 * least one asset that reports inside the 150 s site window (`REPORTING_ASSETS_CTE_SQL`, the
 * window the location cards and the estate "Sites online" read; ADR 0075 Amendment 2), and the
 * location total as `coverage`, so the tile reads `live / total`: `fresh` is the live count,
 * `carrying` every location that owns an asset in scope.
 *
 * The cards' own rules: an inactive location is not a site (`locationKpis` reads
 * `l.active = true`), and liveness is any point, not only `kw`. A location admin holding one
 * location counts one location — the scope is that caller's assets, so a location outside it
 * owns no asset in it. The organization predicate is explicit on both tables, never delegated
 * to RLS (`metric-catalog.service.ts`' file docblock).
 */
export const sitesLiveCount: Resolver = async (tx, organizationId, scope) => {
  if (scope.length === 0) {
    return { shape: "metric", key: "sites.live.count", value: 0, unit: null, coverage: { fresh: 0, carrying: 0 } };
  }
  const result = await tx.execute<{ live: number; total: number }>(sql`
    WITH ${sql.raw(REPORTING_ASSETS_CTE_SQL)}
    SELECT COUNT(DISTINCT a.location_id) FILTER (WHERE reporting.asset_id IS NOT NULL)::int AS live,
           COUNT(DISTINCT a.location_id)::int AS total
      FROM bms.assets a
      JOIN bms.locations l
        ON l.id = a.location_id
       AND l.organization_id = ${organizationId}
       AND l.active
      LEFT JOIN reporting ON reporting.asset_id = a.id
     WHERE a.id = ANY(${sql.param([...scope])}::uuid[])
       AND a.organization_id = ${organizationId}
  `);
  const live = Number(result.rows[0]?.live ?? 0);
  const total = Number(result.rows[0]?.total ?? 0);
  return {
    shape: "metric",
    key: "sites.live.count",
    value: live,
    unit: null,
    coverage: { fresh: live, carrying: total },
  };
};

/**
 * `pue.ratio` — Σ `site_kw` / Σ `it_kw` over the paired incomers in scope, through
 * `latestPueRatio`: the estate tile's own read, its 900 s freshness bound and its `null` for
 * "no fresh pair" (`F2.8` rulings 3 and 4; never a sentinel). On `deps.pool`, the fleet pool,
 * for the reason `ResolverDeps.pool` states.
 */
export const pueRatio: Resolver = async (_tx, _organizationId, scope, deps) => {
  const value = scope.length === 0 ? null : await latestPueRatio(deps.pool, [...scope]);
  return { shape: "metric", key: "pue.ratio", value, unit: null };
};
