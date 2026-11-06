import type { MetricCatalogValueDto } from "@bms/shared";

import type { AssetHealthService } from "../asset-health/asset-health.service";
import type { BmsTx } from "../database/tenant-context";

/**
 * What a resolver may reach for beyond the transaction.
 *
 * Passed explicitly rather than bound as `this`. Eight of the ten entries need nothing here
 * (`assets.health.score` reads `health`; `sustainability.by_location` reads
 * `readableLocationIds` since `F2.10`), and a `this`-bound map would have to be cast to reach
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
};

/**
 * How the catalog's entries resolve: six are SQL here (the four Stage C reads and the two
 * `F3.73` asset reads), one delegates, two roll up a point key, and one (`water.balance`,
 * `E4.3`) folds three role-filtered roll-ups into a row per site.
 *
 * `params` is the binding's stored `params` AFTER `METRIC_CATALOG_PARAMS_WRITE[key]` has
 * parsed it (`E4.2`): `{}` for the five Stage C entries and the two `F3.73` asset entries,
 * `{ pointKey, aggregate }` and an
 * optional `balanceRole` (`E4.3`) for the two sustainability entries — plus an optional
 * `groupDepth` on `by_location` since `F2.10` — and `{ period }` for
 * `water.balance`. Positional and required
 * rather than optional, so a resolver that reads a field cannot compile against a call that
 * never passes one.
 */
export type Resolver = (
  tx: BmsTx,
  organizationId: string,
  scope: readonly string[],
  deps: ResolverDeps,
  params: unknown,
) => Promise<MetricCatalogValueDto>;
