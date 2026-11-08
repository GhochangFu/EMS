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
  // `F4.332` (ADR 0112 Amendment 3) adds the two energy-cost keys: fifteen in all.
  if (keys.length !== 15) fail(`expected 15 catalog keys, got ${keys.length}`);
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

/**
 * `F4.332` / ADR 0112 Amendment 3 item 1 — `energy.cost_by_day` is a dataset taking `days` 1–90,
 * and `energy.cost.total` a metric taking a named `period`; each refuses any other field.
 */
export function theEnergyCostKeysTakeDaysAndPeriod(): void {
  const byDay = METRIC_CATALOG["energy.cost_by_day"];
  if (byDay.shape !== "dataset" || JSON.stringify(byDay.columns) !== JSON.stringify(["day", "kwh", "cost", "currency", "reason"])) {
    fail("energy.cost_by_day must be a dataset of day, kwh, cost, currency, reason");
  }
  const days = METRIC_CATALOG_PARAMS_WRITE["energy.cost_by_day"];
  if (!days.safeParse({ days: 1 }).success || !days.safeParse({ days: 90 }).success) fail("days 1 and 90 must parse");
  if (days.safeParse({ days: 0 }).success || days.safeParse({ days: 91 }).success || days.safeParse({ days: 7.5 }).success) {
    fail("days must be an integer from 1 to 90");
  }
  if (days.safeParse({ days: 30, locationId: "x" }).success) fail("energy.cost_by_day must refuse an undeclared field");
  if (METRIC_CATALOG["energy.cost.total"].shape !== "metric") fail("energy.cost.total must be a metric");
  const period = METRIC_CATALOG_PARAMS_WRITE["energy.cost.total"];
  for (const value of ["today", "last_7_days", "this_month"]) {
    if (!period.safeParse({ period: value }).success) fail(`period ${value} must parse`);
  }
  if (period.safeParse({ period: "this_year" }).success) fail("period this_year is not in this row");
}
