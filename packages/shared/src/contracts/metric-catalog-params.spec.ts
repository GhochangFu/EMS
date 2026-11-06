import { METRIC_CATALOG, metricCatalogKeySchema } from "./dashboard-builder";
import { METRIC_CATALOG_PARAMS_WRITE, sourceBindingWriteSchema } from "./metric-catalog-params";

/**
 * `F4.317` / ADR 0112 decision 9 and Amendment 1 (owner ruling Q1b) — the catalog gains
 * `sites.live.count`, `pue.ratio` and `alarms.critical.count`, all `shape: "metric"` with no
 * params. There is no `tone` param: tile 3 binds `alarms.active.count` and
 * `alarms.critical.count`, because `UNIQUE (widget_id, catalog_key)` forbids one key twice on a
 * widget. One exported function per case, one `it()` per function in the sibling `.test.ts` (§4.6).
 */

const fail = (message: string): never => {
  throw new Error(message);
};

const NEW_METRICS = ["sites.live.count", "pue.ratio", "alarms.critical.count"] as const;

export function theCatalogHoldsThirteenKeysWithTheThreeNewMetrics(): void {
  const keys = metricCatalogKeySchema.options;
  if (keys.length !== 13) fail(`expected 13 catalog keys, got ${keys.length}`);
  for (const key of NEW_METRICS) {
    if (!keys.includes(key)) fail(`${key} must be a catalog key`);
    const entry = METRIC_CATALOG[key];
    if (entry.shape !== "metric") fail(`${key} must be a metric`);
    if (entry.params !== undefined) fail(`${key} must declare no params`);
    if (METRIC_CATALOG_PARAMS_WRITE[key].safeParse({}).success !== true) fail(`${key} must accept {}`);
    if (METRIC_CATALOG_PARAMS_WRITE[key].safeParse({ tone: "critical" }).success) {
      fail(`${key} must refuse a field it does not declare`);
    }
  }
}

export function alarmsActiveCountTakesNoToneParam(): void {
  const entry = METRIC_CATALOG["alarms.active.count"];
  if (entry.shape !== "metric" || entry.params !== undefined) {
    fail("alarms.active.count must be a metric with no params (ADR 0112 Amendment 1)");
  }
  const withTone = metricCatalogKeySchema.options.filter((key) =>
    (METRIC_CATALOG[key].params ?? []).includes("tone"),
  );
  if (withTone.length !== 0) fail(`no catalog key may declare tone, got ${JSON.stringify(withTone)}`);
  const schema = METRIC_CATALOG_PARAMS_WRITE["alarms.active.count"];
  if (schema.safeParse({}).success !== true) fail("alarms.active.count must accept {}");
  if (schema.safeParse({ tone: "critical" }).success) fail("alarms.active.count must refuse tone");
}

export function aBindingOfAlarmsCriticalCountParsesAndRefusesAField(): void {
  const ok = sourceBindingWriteSchema.safeParse({ catalogKey: "alarms.critical.count", params: {} });
  if (!ok.success) fail(`an alarms.critical.count binding must parse: ${ok.error.message}`);
  const bad = sourceBindingWriteSchema.safeParse({
    catalogKey: "alarms.critical.count",
    params: { tone: "critical" },
  });
  if (bad.success) fail("an alarms.critical.count binding with a field must be refused");
}
