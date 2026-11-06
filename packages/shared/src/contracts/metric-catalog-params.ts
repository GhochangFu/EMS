import { z } from "zod";

import {
  metricCatalogKeySchema,
  sustainabilityAggregateSchema,
  waterBalancePeriodSchema,
} from "./dashboard-builder";
import { CATALOG_CODE_MESSAGE, CATALOG_CODE_PATTERN } from "../constants";
import { waterBalanceRoleCodeSchema } from "./operations";
import { LOCATION_TREE_MAX_DEPTH } from "../location-tree";

type MetricCatalogKey = z.infer<typeof metricCatalogKeySchema>;

// `F4.317` — moved byte for byte out of `dashboard-writes.ts`, which sat at 996 of §4.5's 1000
// lines; `dashboard-writes.ts` re-exports `METRIC_CATALOG_PARAMS_WRITE` and imports
// `sourceBindingWriteSchema`.

/**
 * The write-side parameter schema for every catalog entry (`F3.35` Stage C, ADR 0048).
 *
 * **A `Record` keyed on the vocabulary, so a sixth catalog entry cannot compile without an entry
 * here.** That is the same forcing `WIDGET_POINT_CARDINALITY` gives the point side, and it is
 * why this is a map rather than one shared schema.
 *
 * **An entry declares a field only when the query that reads it exists.** A parameter nothing
 * reads is a value an author sets, saves, and sees no effect from — the `F4.43` shape with the
 * store on its side rather than the renderer's. The five Stage C entries are still empty for
 * that reason. `E4.2` / ADR 0072 decision 2 added the first two with fields: the sustainability
 * roll-ups take `{ pointKey, aggregate }`, and `MetricCatalogService` reads both. `pointKey` is
 * bounded and charset-checked here; whether it names an ACTIVE catalog code is the write path's
 * check against `bms.point_keys` (the `assertPointKeysActive` rule, ADR 0072 decision 2), which
 * a schema with no database cannot make. `E4.3` / ADR 0073 decision 2 added an optional third,
 * `balanceRole`: it narrows the carrying set (and so the coverage) to assets whose
 * `water_balance_role` is that code, and `readRollupRows` reads it. Shape only here; that the
 * code is a LIVE `bms.water_balance_roles` row is the write path's check
 * (`assertSourceParamsBalanceRolesActive`) — an unknown code would otherwise match no asset
 * and answer `0/0` with a green console.
 *
 * **DO NOT COLLAPSE THIS MAP INTO ONE SCHEMA.** The Stage C entries are identical and will not
 * stay identical: `alarms.active` takes a severity filter and `workorders.open` takes a status,
 * and one shared object would silently give every entry both. The two sustainability entries
 * spread ONE fields const (`sustainabilityParamsFields`) into TWO strict objects: the fields
 * are spelled once, the schemas stay separate, and the containment test counts `.strict()` per
 * key and reads the spread const for the id bans.
 *
 * **NO ENTRY MAY DECLARE A `z.string().uuid()` FIELD**, and this is the load-bearing rule rather
 * than a style note. A binding inherits its dashboard's scope (`dashboards.location_id` /
 * `asset_group_id`); a location id inside `params` would be an id inside `jsonb` that no foreign
 * key covers and no orphan check can report — the ADR 0019 problem ADR 0048 decision 4 created a
 * fourth table to refuse, arriving one column over. The database's only bound is
 * `dashboard_widget_sources_params_object_check`, which accepts `{"locationId": "<any uuid>"}`.
 * `tests/f3.35-metric-catalog-containment.test.ts` scans this map and fails the build on `.uuid(`.
 */
const sustainabilityParamsFields = {
  pointKey: z.string().min(1).max(64).regex(CATALOG_CODE_PATTERN, CATALOG_CODE_MESSAGE),
  aggregate: sustainabilityAggregateSchema,
  balanceRole: waterBalanceRoleCodeSchema.optional(),
};

export const METRIC_CATALOG_PARAMS_WRITE: Record<MetricCatalogKey, z.AnyZodObject> = {
  "alarms.active.count": z.object({}).strict(),
  "alarms.active": z.object({}).strict(),
  "workorders.open.count": z.object({}).strict(),
  "workorders.open": z.object({}).strict(),
  "assets.health.score": z.object({}).strict(),
  "sustainability.total": z.object({ ...sustainabilityParamsFields }).strict(),
  // `F2.10` (ADR 0098 Amendment 1, C) — an optional grouping depth, root = 1; a count, not an
  // id. Kept as one `z.object(` token: the f3.35 containment scan finds the entry by it.
  "sustainability.by_location": z.object({
    ...sustainabilityParamsFields,
    groupDepth: z.number().int().min(1).max(LOCATION_TREE_MAX_DEPTH).optional(),
  }).strict(),
  // `E4.3` / ADR 0073 decision 3 — one row per balance-carrying site for one calendar period.
  "water.balance": z.object({ period: waterBalancePeriodSchema }).strict(),
  // `F3.73` — both resolve over the dashboard's (or the tab's) scope and take no params.
  "assets.offline.count": z.object({}).strict(),
  "assets.list": z.object({}).strict(),
};

/**
 * One catalog binding on a widget.
 *
 * `params` is validated against the entry's own schema in a `superRefine` rather than by a
 * `z.discriminatedUnion` over `catalogKey`: the union would need a tuple type built from the
 * `Record`, which costs a cast, and the refinement states the same rule with the failing key
 * named in the message.
 */
export const sourceBindingWriteSchema = z
  .object({
    catalogKey: metricCatalogKeySchema,
    params: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
    sortOrder: z.number().int().min(0).default(0),
  })
  .strict()
  .superRefine((binding, ctx) => {
    const parsed = METRIC_CATALOG_PARAMS_WRITE[binding.catalogKey].safeParse(binding.params);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["params", ...issue.path],
          message: `${binding.catalogKey}: ${issue.message}`,
        });
      }
    }
  })
  .describe(
    "One named catalog binding (ADR 0048 decision 4). `params` is validated against the " +
      "entry's own schema, which differs per `catalogKey`: the five Stage C entries declare no " +
      "fields (`{}` only), and `sustainability.total` / `sustainability.by_location` require " +
      "`{ pointKey, aggregate }` (ADR 0072) plus an optional `balanceRole`, a " +
      "`bms.water_balance_roles` code that narrows the carrying assets to that role (ADR 0073 " +
      "decision 2; without it, every asset carrying the point counts, so a water total sums " +
      "every stage's inlet); `sustainability.by_location` also takes an optional integer " +
      "`groupDepth` (1 = the root; ADR 0098 Amendment 1) that groups its rows by the ancestor at " +
      "that depth — a node shallower than the depth is its own row, and an unset depth is one row " +
      "per node; and `water.balance` " +
      "requires `{ period }` (ADR 0073 decision 3; today / this_month / this_year) — " +
      "zod-to-json-schema emits nothing for a " +
      "refinement, so without this line the document would promise that any record of scalars " +
      "is accepted where the API answers 400 (ADR 0029 Amendment 1). No entry may declare a " +
      "uuid: an id inside `params` is an id inside jsonb that no foreign key covers.",
  );
