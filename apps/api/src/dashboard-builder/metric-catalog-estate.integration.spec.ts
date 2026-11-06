import { expect } from "vitest";

import type { MetricCatalogValueDto } from "@bms/shared";

import type { MetricCatalogService } from "./metric-catalog.service";

/**
 * `F4.317` (ADR 0112 decisions 7–9 and Amendment 1) — assertions for the three catalog keys the
 * organization KPI strip adds, and for the prior a tile asks for. The sibling
 * `.integration.test.ts` owns the database lifecycle and the fixture (ADR 0014).
 *
 * Every read passes the fixture's own asset ids as the caller's readable set, so each number is
 * the fixture's and no parallel suite can move it (`metric-catalog.integration.test.ts` states
 * why this suite makes no organization of its own).
 */

type MetricArm = Extract<MetricCatalogValueDto, { shape: "metric" }>;

/** The resolved metric of one widget's binding of `catalogKey`, or a failed expectation. */
async function metricOf(
  service: MetricCatalogService,
  organizationId: string,
  dashboardId: string,
  callerScope: readonly string[],
  widgetId: string,
  catalogKey: string,
): Promise<MetricArm | undefined> {
  const resolved = await service.resolveForDashboard(organizationId, dashboardId, [...callerScope], null);
  const entry = resolved.values.find(
    (value) => value.widgetId === widgetId && value.catalogKey === catalogKey,
  )?.resolved;
  expect(entry?.shape, `${catalogKey} must resolve as a metric`).toBe("metric");
  return entry?.shape === "metric" ? entry : undefined;
}

/**
 * Decision 7 — a site is a location. `sites.live.count` is the locations in scope with an asset
 * that reports inside the 150 s window, and its `coverage` carries the location total, so the
 * tile reads `live / total`. Two assets at one location are ONE site.
 */
export async function assertSitesLiveCountsLocations(
  service: MetricCatalogService,
  organizationId: string,
  dashboardId: string,
  widgetId: string,
  callerScope: readonly string[],
  expected: { readonly value: number; readonly fresh: number; readonly carrying: number },
): Promise<void> {
  const metric = await metricOf(service, organizationId, dashboardId, callerScope, widgetId, "sites.live.count");
  expect(
    { value: metric?.value, coverage: metric?.coverage },
    "sites.live.count must count LOCATIONS with a reporting asset, over the caller's assets, " +
      "with the location total as coverage.carrying",
  ).toEqual({ value: expected.value, coverage: { fresh: expected.fresh, carrying: expected.carrying } });
}

/**
 * `pue.ratio` is `latestPueRatio` over the scope — Σ `site_kw` / Σ `it_kw` of the paired
 * incomers — and `null`, never a sentinel, when no incomer in scope has the pair (`F2.8` ruling 4).
 */
export async function assertPueRatioReadsThePairOrNull(
  service: MetricCatalogService,
  organizationId: string,
  dashboardId: string,
  widgetId: string,
  scopeWithPair: readonly string[],
  expectedRatio: number,
  scopeWithoutPair: readonly string[],
): Promise<void> {
  const paired = await metricOf(service, organizationId, dashboardId, scopeWithPair, widgetId, "pue.ratio");
  expect(paired?.value, "pue.ratio over a paired incomer is Σ site_kw / Σ it_kw").toBeCloseTo(expectedRatio, 6);
  const unpaired = await metricOf(service, organizationId, dashboardId, scopeWithoutPair, widgetId, "pue.ratio");
  expect(unpaired?.value, "pue.ratio with no paired incomer in scope is null, not 1 and not 0").toBeNull();
}

/**
 * Tile 3 (ruling Q1b) — one widget binds `alarms.active.count` and `alarms.critical.count`. The
 * first counts every uncleared alarm; the second only those whose severity has tone `critical`
 * (the `kpis()` predicate). The fixture holds a non-critical open alarm and a cleared critical
 * one, so neither count can pass by being the other.
 */
export async function assertActiveAndCriticalPairOnOneTile(
  service: MetricCatalogService,
  organizationId: string,
  dashboardId: string,
  widgetId: string,
  callerScope: readonly string[],
  expectedActive: number,
  expectedCritical: number,
): Promise<void> {
  const active = await metricOf(service, organizationId, dashboardId, callerScope, widgetId, "alarms.active.count");
  const critical = await metricOf(service, organizationId, dashboardId, callerScope, widgetId, "alarms.critical.count");
  expect(active?.value, "alarms.active.count counts every uncleared alarm in scope").toBe(expectedActive);
  expect(
    critical?.value,
    "alarms.critical.count counts the uncleared alarms whose severity has tone critical",
  ).toBe(expectedCritical);
  expect(expectedCritical < expectedActive, "the fixture must tell the two counts apart").toBe(true);
}

/**
 * Decision 8 / ruling Q5 — the prior. A tile that asks (`compareToPrevious`) gets `prior`, the
 * value at `resolvedAt − 24 h` on the metric's own definition (ADR 0074 decision 5); a tile with
 * the same binding that does not ask gets no `prior` key at all, so it costs no read.
 */
export async function assertPriorOnlyWhenAsked(
  service: MetricCatalogService,
  organizationId: string,
  dashboardId: string,
  callerScope: readonly string[],
  askingWidgetId: string,
  plainWidgetId: string,
  catalogKey: string,
  expected: { readonly live: number | null; readonly prior: number | null },
): Promise<void> {
  const resolved = await service.resolveForDashboard(organizationId, dashboardId, [...callerScope], null);
  const of = (widgetId: string) => {
    const entry = resolved.values.find(
      (value) => value.widgetId === widgetId && value.catalogKey === catalogKey,
    )?.resolved;
    return entry?.shape === "metric" ? entry : undefined;
  };
  const asking = of(askingWidgetId);
  const plain = of(plainWidgetId);
  expect(asking?.value, `${catalogKey}: the live value`).toBe(expected.live);
  expect(asking?.prior?.value, `${catalogKey}: the prior is the value 24 h before resolvedAt`).toBe(
    expected.prior,
  );
  expect(
    asking?.prior?.asOf,
    "prior.asOf is exactly 24 h before the response's resolvedAt",
  ).toBe(new Date(Date.parse(resolved.resolvedAt) - 24 * 3_600_000).toISOString());
  expect(plain?.value, `${catalogKey}: the tile that does not ask still resolves`).toBe(expected.live);
  expect(plain !== undefined && "prior" in plain, "a tile without compareToPrevious carries no prior key").toBe(
    false,
  );
}

/**
 * `priorOpenAlarmsInScope` at its edges — open at `at` means `raised_at <= at` and not cleared by
 * then (`cleared_at > at`), the estate `priorOpenAlarms` rule (`kpi-prior.ts`). The fixture alarm
 * is raised at exactly `raisedAt`, cleared an hour later, and is not critical.
 */
export async function assertPriorOpenAlarmsEdges(
  count: (at: Date, criticalOnly: boolean) => Promise<number>,
  raisedAt: Date,
): Promise<void> {
  expect(await count(raisedAt, false), "raised_at = at: the alarm is open at `at`").toBe(1);
  expect(await count(new Date(raisedAt.getTime() - 1), false), "raised a millisecond after `at`").toBe(0);
  expect(
    await count(new Date(raisedAt.getTime() + 3_600_000), false),
    "cleared_at = at: the alarm is closed at `at`",
  ).toBe(0);
  expect(await count(raisedAt, true), "criticalOnly leaves out a non-critical alarm").toBe(0);
}
