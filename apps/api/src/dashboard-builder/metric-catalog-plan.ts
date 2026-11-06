import { METRIC_CATALOG_PARAMS_WRITE, type MetricCatalogKey } from "@bms/shared";

import { scopeKeyFor, type DashboardAssetScope } from "./dashboard-scope-assets";
import { PRIOR_KEYS } from "./metric-catalog-prior";

/**
 * `F4.317` — the resolve planner, moved out of `metric-catalog.service.ts` byte-for-byte to keep
 * that file under the AGENTS.md §4.5 cap before `resolveBindings` is lifted (task 4.2). Pure.
 */

/** One stored binding, as `resolveWidgetSources` returns it — the fields `planResolves` reads. */
export type PlannableSource = {
  readonly id: string;
  readonly widgetId: string;
  readonly catalogKey: string;
  readonly params: unknown;
};

/** One distinct resolve: an entry, its parsed params, and the scope it runs over. */
export type PlannedResolve = {
  readonly key: MetricCatalogKey;
  readonly params: unknown;
  readonly scope: DashboardAssetScope;
  readonly scopeKey: string;
  /** `F2.10` — a location scope resolves over the node's subtree (`SUBTREE_SCOPED_KEYS`). */
  readonly subtree: boolean;
  /** `F4.317` — the tile asks for the prior and the entry has one (`PRIOR_KEYS`). */
  readonly wantsPrior: boolean;
};

/**
 * `F2.10` / ADR 0098 decision 7, B1 — the entries whose location scope is the node's SUBTREE.
 * Every other entry (the alarm and work-order reads, `assets.*`, `water.balance`) stays per
 * node: a campus dashboard's alarm list is the campus's own, not its sites'.
 */
const SUBTREE_SCOPED_KEYS: ReadonlySet<MetricCatalogKey> = new Set<MetricCatalogKey>([
  "sustainability.total",
  "sustainability.by_location",
]);

/**
 * Groups a dashboard's bindings into DISTINCT resolves, keyed `(catalogKey, canonical params,
 * scope key)` — pure, so the dedupe is claimed without a database
 * (`metric-catalog.service.spec.ts`).
 *
 * `E4.2`: two tiles binding `sustainability.total` with different point keys are two resolves,
 * and two tiles binding `alarms.active.count` are one because their params are both `{}`.
 * `F3.73` (plan D3): the key gains the widget's scope, because the same key on two tabs bound
 * to two groups is two different numbers — without it the second tile shows the first tab's
 * count, and nothing throws.
 *
 * A binding whose params fail the entry's write schema is reported through `onInvalid` (field
 * paths only) and left out; a key with no write schema is left out silently, as before.
 *
 * `F4.317` (ADR 0112 decision 8, ruling Q5): the key also carries whether the widget asks for
 * the prior (`wantsPriorOf`), for an entry that has one (`PRIOR_KEYS`). The tile that asks is a
 * resolve of its own, so the same binding on a tile that does not ask reads no prior.
 */
export function planResolves(
  sources: readonly PlannableSource[],
  scopeOfWidget: (widgetId: string) => DashboardAssetScope,
  wantsPriorOf: (widgetId: string) => boolean,
  onInvalid: (source: PlannableSource, key: MetricCatalogKey, paths: string) => void,
): {
  readonly resolveKeyOf: ReadonlyMap<string, string>;
  readonly resolves: ReadonlyMap<string, PlannedResolve>;
} {
  const resolveKeyOf = new Map<string, string>();
  const resolves = new Map<string, PlannedResolve>();
  for (const source of sources) {
    const key = source.catalogKey as MetricCatalogKey;
    const schema = METRIC_CATALOG_PARAMS_WRITE[key];
    if (schema === undefined) continue;
    const parsed = schema.safeParse(source.params);
    if (!parsed.success) {
      onInvalid(source, key, parsed.error.issues.map((issue) => issue.path.join(".")).join(","));
      continue;
    }
    const scope = scopeOfWidget(source.widgetId);
    const subtree = SUBTREE_SCOPED_KEYS.has(key);
    const scopeKey = scopeKeyFor(scope, { subtree });
    const wantsPrior = PRIOR_KEYS.has(key) && wantsPriorOf(source.widgetId);
    const resolveKey = `${key}\u0000${canonicalJson(parsed.data)}\u0000${scopeKey}${wantsPrior ? "\u0000prior" : ""}`;
    resolveKeyOf.set(source.id, resolveKey);
    if (!resolves.has(resolveKey)) {
      resolves.set(resolveKey, { key, params: parsed.data, scope, scopeKey, subtree, wantsPrior });
    }
  }
  return { resolveKeyOf, resolves };
}

/**
 * A key-sorted JSON encoding, so `{ pointKey, aggregate }` and `{ aggregate, pointKey }` are
 * one resolve. The write schemas are flat objects of scalars, so one level of sorting is the
 * whole canonical form.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  const record = value as Record<string, unknown>;
  return JSON.stringify(
    Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]])),
  );
}

/**
 * `F4.317` task 4.2 — what `MetricCatalogService.resolveBindings` resolves: the widgets (the
 * group their tab binds, `null` for none; the type and config `widgetWantsPrior` reads), their
 * sources, the scope a widget with no tab group resolves over, and the `by_location` cap node
 * (`ResolverDeps.scopeLocationId`).
 */
export type CatalogBindings = {
  readonly widgets: readonly {
    readonly id: string;
    readonly tabGroupId: string | null;
    readonly widgetType: string;
    readonly config: unknown;
  }[];
  readonly sources: readonly PlannableSource[];
  readonly scope: DashboardAssetScope;
  readonly capLocationId: string | null;
};
