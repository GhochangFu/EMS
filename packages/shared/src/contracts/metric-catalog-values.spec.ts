import { metricCatalogValueDtoSchema } from "./metric-catalog-values";

/**
 * `F4.317` / ADR 0112 decision 8 — the metric arm gains an optional `prior`
 * (`{ asOf, value }`, ADR 0074 decision 5's 24 h rule). Optional, because every existing
 * emitter emits none and a resolve computes one only for a tile that asks (owner ruling Q5).
 */

const fail = (message: string): never => {
  throw new Error(message);
};

const METRIC = { shape: "metric", key: "alarms.active.count", value: 3, unit: null } as const;

export function aMetricParsesWithAndWithoutPrior(): void {
  const without = metricCatalogValueDtoSchema.safeParse(METRIC);
  if (!without.success) fail(`a metric with no prior must parse: ${without.error.message}`);
  if (without.success && "prior" in without.data) fail("an absent prior must stay absent");

  const withPrior = metricCatalogValueDtoSchema.safeParse({
    ...METRIC,
    prior: { asOf: "2026-11-05T06:00:00.000Z", value: 1 },
  });
  if (!withPrior.success) fail(`a metric with a prior must parse: ${withPrior.error.message}`);
  if (withPrior.success && withPrior.data.shape === "metric" && withPrior.data.prior?.value !== 1) {
    fail("the prior value must survive the parse");
  }

  const nullPrior = metricCatalogValueDtoSchema.safeParse({
    ...METRIC,
    prior: { asOf: "2026-11-05T06:00:00.000Z", value: null },
  });
  if (!nullPrior.success) fail("a prior with no value (null) must parse");
}

export function aMalformedPriorIsRefused(): void {
  if (metricCatalogValueDtoSchema.safeParse({ ...METRIC, prior: { value: 1 } }).success) {
    fail("a prior with no asOf must be refused");
  }
  if (metricCatalogValueDtoSchema.safeParse({ ...METRIC, prior: { asOf: "x", value: "1" } }).success) {
    fail("a prior with a string value must be refused");
  }
}
