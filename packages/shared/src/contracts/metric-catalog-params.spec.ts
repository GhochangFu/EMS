import { METRIC_CATALOG, metricCatalogKeySchema } from "./dashboard-builder";
import { METRIC_CATALOG_PARAMS_WRITE, sourceBindingWriteSchema } from "./metric-catalog-params";

/**
 * `F4.317` / ADR 0112 decision 9 — the catalog gains `sites.live.count` and `pue.ratio` (both
 * `shape: "metric"`, no params), and `alarms.active.count` gains an optional `tone` param
 * (`"critical"` only in this phase), strict, with no id. One exported function per case, one
 * `it()` per function in the sibling `.test.ts` (§4.6).
 */

const fail = (message: string): never => {
  throw new Error(message);
};

export function theCatalogHoldsTwelveKeysWithTheTwoNewMetrics(): void {
  const keys = metricCatalogKeySchema.options;
  if (keys.length !== 12) fail(`expected 12 catalog keys, got ${keys.length}`);
  for (const key of ["sites.live.count", "pue.ratio"] as const) {
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

export function toneIsDeclaredOnAlarmsActiveCountOnly(): void {
  const withTone = metricCatalogKeySchema.options.filter((key) =>
    (METRIC_CATALOG[key].params ?? []).includes("tone"),
  );
  if (JSON.stringify(withTone) !== JSON.stringify(["alarms.active.count"])) {
    fail(`only alarms.active.count may declare tone, got ${JSON.stringify(withTone)}`);
  }
  const entry = METRIC_CATALOG["alarms.active.count"];
  if (entry.shape !== "metric" || JSON.stringify(entry.params) !== JSON.stringify(["tone"])) {
    fail("alarms.active.count must be a metric with params [tone]");
  }
}

export function toneAcceptsCriticalAndOmittedOnly(): void {
  const schema = METRIC_CATALOG_PARAMS_WRITE["alarms.active.count"];
  if (schema.safeParse({}).success !== true) fail("an omitted tone must parse");
  if (schema.safeParse({ tone: "critical" }).success !== true) fail('tone "critical" must parse');
  if (schema.safeParse({ tone: "warning" }).success) fail('tone "warning" must be refused');
  if (schema.safeParse({ tone: "critical", locationId: "00000000-0000-4000-8000-000000000000" }).success) {
    fail("an extra id field must be refused (strict)");
  }
}

export function aBindingCarriesToneThroughTheWriteSchema(): void {
  const ok = sourceBindingWriteSchema.safeParse({
    catalogKey: "alarms.active.count",
    params: { tone: "critical" },
  });
  if (!ok.success) fail(`a tone binding must parse: ${ok.error.message}`);
  const bad = sourceBindingWriteSchema.safeParse({
    catalogKey: "alarms.active.count",
    params: { tone: "warning" },
  });
  if (bad.success) fail("a binding with tone warning must be refused");
  const path = bad.error?.issues[0]?.path.join(".");
  if (path !== "params.tone") fail(`the refusal must name params.tone, got ${path}`);
}
