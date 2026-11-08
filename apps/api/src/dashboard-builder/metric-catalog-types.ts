import type { MetricCatalogValueDto } from "@bms/shared";
import type { Pool } from "pg";

import type { AssetHealthService } from "../asset-health/asset-health.service";
import type { BmsTx } from "../database/tenant-context";
import type { TariffSeriesResolver } from "../telemetry/energy-cost-by-day";

/**
 * What a resolver may reach for beyond the transaction.
 *
 * Passed explicitly rather than bound as `this`. Most entries need nothing here
 * (`assets.health.score` reads `health`; `sustainability.by_location` reads
 * `readableLocationIds` since `F2.10`; `pue.ratio` reads `pool` since `F4.317`), and a
 * `this`-bound map would have to be cast to reach
 * the service's injected dependency — a cast on the one path that calls another module's service.
 */
export type ResolverDeps = {
  readonly health: AssetHealthService;
  /**
   * `F2.10` — the reader's location ids, `null` when unrestricted. Only `by_location`'s
   * `groupDepth` reads it: a group label is never an ancestor the reader cannot read (A6).
   */
  readonly readableLocationIds: ReadonlySet<string> | null;
  /**
   * `F2.10` owner rulings P1 and P4 — the dashboard's own location node, for every widget on
   * it (a group tab's widget included): its `locationId`, or for a group-scoped dashboard the
   * GROUP's `location_id` read from the database; `null` for an asset- or organization-scoped
   * dashboard. `by_location`'s group never goes above it.
   */
  readonly scopeLocationId: string | null;
  /**
   * `F4.317` (ADR 0112) — the service's `FLEET_POOL`, for `pue.ratio`, which reads through
   * `latestPueRatio` (`telemetry/pue-ratio.ts`) as the estate tile does. That read joins
   * `bms.assets` with no organization predicate, so the `$1::uuid[]` scope — the resolved,
   * organization-bounded asset ids — is the isolation control, exactly as on the estate path.
   * `Pick<Pool, "query">`, the type `latestPueRatio` takes. An entry that reads this (or
   * `health`) must be in `RESOLVE_AFTER_COMMIT` (`metric-catalog.service.ts`), so the read runs
   * after the tenant transaction has committed, never while it holds its connection.
   */
  readonly pool: Pick<Pool, "query">;
  /**
   * `F4.332` (ADR 0070 Amendment 7) — the dated `energy_tariff_per_kwh` rows, for the two
   * `energy.cost*` entries: `CalcParametersService.resolveSeriesForAssets` on the fleet Drizzle.
   * Read after commit, like `pool`.
   */
  readonly tariffs: TariffSeriesResolver;
};

/**
 * How a catalog entry resolves (`RESOLVERS` in `metric-catalog.service.ts` names every one):
 * most are SQL in that file — the Stage C reads, the `F3.73` asset reads and `F4.317`'s
 * `alarms.critical.count` — and `F4.317`'s `sites.live.count` and `pue.ratio` are SQL in
 * `metric-catalog-estate.ts`; `assets.health.score` delegates, the two `sustainability.*`
 * entries roll up a point key, and `water.balance` (`E4.3`) folds three role-filtered roll-ups
 * into a row per site.
 *
 * `params` is the binding's stored `params` AFTER `METRIC_CATALOG_PARAMS_WRITE[key]` has
 * parsed it (`E4.2`): `{}` for every entry that declares no params (the Stage C, `F3.73` and
 * `F4.317` entries),
 * `{ pointKey, aggregate }` and an
 * optional `balanceRole` (`E4.3`) for the two sustainability entries — plus an optional
 * `groupDepth` on `by_location` since `F2.10` — and `{ period }` for
 * `water.balance`. Positional and required
 * rather than optional, so a resolver that reads a field cannot compile against a call that
 * never passes one.
 *
 * `priorAt` (`F4.317`, ADR 0112 decision 8) is the instant 24 h before the resolve when the
 * binding's tile asks for "vs yesterday" (`compareToPrevious`, owner ruling Q5), else `null`. An
 * entry with a prior read (`PRIOR_KEYS`, `metric-catalog-prior.ts`) emits `prior` exactly when
 * it is set; every other entry ignores it. Positional and required for the same reason.
 */
export type Resolver = (
  tx: BmsTx,
  organizationId: string,
  scope: readonly string[],
  deps: ResolverDeps,
  params: unknown,
  priorAt: Date | null,
) => Promise<MetricCatalogValueDto>;
