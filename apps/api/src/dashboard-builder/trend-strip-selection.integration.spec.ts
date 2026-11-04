import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";

import { putDashboardWidgetsBodySchema } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import type { DashboardsService } from "./dashboards.service";
import { trendStripPointOffListMessage } from "./trend-strip-selection.check";

/**
 * `F4.306` U5 (ADR 0108 Amendment 7) — the trend strip selection check on the write path the
 * builder's Save and the copilot's dashboard step both take (`DashboardsService.putWidgets`),
 * against a real database: the organization's effective lists are the ones `F4.300` resolves.
 * Assertions live here; `trend-strip-selection.integration.test.ts` is the Vitest entry point
 * (ADR 0014) and owns the fixture, the pools and the cleanup.
 */

export type TrendStripSelectionFixture = {
  readonly service: DashboardsService;
  readonly actor: JwtPayload;
  /** A site dashboard of the organization. */
  readonly dashboardId: string;
  /** A segment whose effective list has at least one point, and its first point code. */
  readonly segment: string;
  readonly pointCode: string;
  /** How many times `TrendPointsService.effective` has run on this service. */
  readonly effectiveCalls: () => number;
};

/** A catalog-pattern code no seeded `point_keys` row carries. */
const OFF_LIST = "f4306zzoff";

const strip = (config: Record<string, unknown>) => ({
  widgetType: "trend_strip",
  title: "Trends",
  gridX: 0,
  gridY: 0,
  gridW: 12,
  gridH: 4,
  config: { defaultRange: "24h", ...config },
  points: [],
});

const put = (f: TrendStripSelectionFixture, widgets: unknown[]) =>
  f.service.putWidgets(f.actor, f.dashboardId, putDashboardWidgetsBodySchema.parse({ widgets }));

async function refusal(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  return undefined;
}

/** A valid selection saves, and the stored config reads back equal to the body's, lists in order. */
export async function aValidSelectionSavesAndReadsBackEqual(f: TrendStripSelectionFixture): Promise<void> {
  const entry = `${f.segment}:${f.pointCode}`;
  const config = { defaultRange: "7d", segments: [f.segment], points: [entry], colors: { [entry]: "series-2" } };
  const before = f.effectiveCalls();
  const dto = await put(f, [strip(config)]);
  expect(f.effectiveCalls(), "a selection reads the lists once").toBe(before + 1);
  const saved = dto.widgets.find((widget) => widget.widgetType === "trend_strip");
  // `jsonb` stores object keys in its own order, so the round trip is equal value by value with
  // every list in body order (`toStrictEqual`), not byte-equal text.
  expect(saved?.config).toStrictEqual(config);
}

/** A point off its segment's list is a 400 naming the indexes only. */
export async function aPointOffTheListIsRefusedNamingTheIndex(f: TrendStripSelectionFixture): Promise<void> {
  const err = await refusal(() =>
    put(f, [strip({ segments: [f.segment], points: [`${f.segment}:${f.pointCode}`, `${f.segment}:${OFF_LIST}`] })]),
  );
  expect(err).toBeInstanceOf(BadRequestException);
  const message = (err as BadRequestException).message;
  expect(message).toBe(trendStripPointOffListMessage(0, 1));
  expect(message).not.toMatch(OFF_LIST);
  expect(message).not.toMatch(f.segment);
}

/** A trend strip without a selection saves without reading the lists: no extra statement. */
export async function aStripWithoutSelectionNeverReadsTheLists(f: TrendStripSelectionFixture): Promise<void> {
  const before = f.effectiveCalls();
  const dto = await put(f, [strip({})]);
  expect(dto.widgets.map((widget) => widget.widgetType)).toEqual(["trend_strip"]);
  expect(f.effectiveCalls()).toBe(before);
}
