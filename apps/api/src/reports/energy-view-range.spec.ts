import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";

import type { AggregateLevel } from "@bms/shared";

import {
  displayBucketFor,
  levelAndBucketFor,
  previousPeriod,
  resolveEnergyRange,
  zoneForArithmetic,
} from "./energy-view-range";

/**
 * `F4.298` U2 (ADR 0108 decisions 2.2, 2.4 and 2.8) — the energy view's range,
 * compare period, display bucket and read level. Every expected value is an
 * instant or a count the plan pins, never one re-derived here. The `.test.ts`
 * wrapper pins `process.env.TZ = "America/St_Johns"` (the `report-period.spec`
 * pattern), so a host-zone leak cannot pass by accident.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function expectBadRequest(run: () => unknown, messagePart: string): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(BadRequestException);
  expect((caught as Error).message).toContain(messagePart);
}

export function assertTodayStartsAtLocalMidnightInKolkata(): void {
  const now = new Date("2026-10-31T05:00:00Z");
  const range = resolveEnergyRange({ range: "today" }, zoneForArithmetic("Asia/Kolkata", "UTC"), now);
  expect(range.start.toISOString()).toBe("2026-10-30T18:30:00.000Z");
  expect(range.end.toISOString()).toBe(now.toISOString());
}

/**
 * New York leaves EDT at 02:00 local on 2026-11-01, so the month starts at
 * 00:00 EDT = 04:00Z. From there to 12:00Z on the 15th is 14 × 24 + 8 = 344
 * elapsed hours: the 25-hour local day counted once, by elapsed time. (The
 * plan's "345" counts 12:00Z as 08:00 local; it is 07:00 EST.)
 */
export function assertThisMonthAcrossTheNewYorkDstChange(): void {
  const now = new Date("2026-11-15T12:00:00Z");
  const range = resolveEnergyRange({ range: "this_month" }, zoneForArithmetic(null, "America/New_York"), now);
  expect(range.start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
  expect(range.end.toISOString()).toBe(now.toISOString());
  expect(range.durationHours).toBe(344);
}

export function assertStoredUtcResolvesThroughEtcUtc(): void {
  const zone = zoneForArithmetic(null, "UTC");
  expect(zone).toEqual({ timeZone: "UTC", arithmeticZone: "Etc/UTC" });
  // The arithmetic runs on Etc/UTC without a throw from the formatter.
  const range = resolveEnergyRange({ range: "today" }, zone, new Date("2026-10-31T05:00:00Z"));
  expect(range.start.toISOString()).toBe("2026-10-31T00:00:00.000Z");
}

export function assertAnInvalidLocationZoneFallsToTheOrganization(): void {
  expect(zoneForArithmetic("Not/AZone", "Asia/Kolkata")).toEqual({
    timeZone: "Asia/Kolkata",
    arithmeticZone: "Asia/Kolkata",
  });
}

export function assertTrailingPresetsEndAtNow(): void {
  const now = new Date("2026-10-31T05:00:00Z");
  const zone = zoneForArithmetic(null, "Asia/Kolkata");
  const expectations: ReadonlyArray<readonly ["24h" | "7d" | "30d" | "1y", number]> = [
    ["24h", 24],
    ["7d", 7 * 24],
    ["30d", 30 * 24],
    ["1y", 365 * 24],
  ];
  for (const [preset, hours] of expectations) {
    const range = resolveEnergyRange({ range: preset }, zone, now);
    expect(range.end.toISOString(), preset).toBe(now.toISOString());
    expect(range.start.getTime(), preset).toBe(now.getTime() - hours * HOUR_MS);
    expect(range.durationHours, preset).toBe(hours);
  }
}

export function assertPreviousPeriodEndsOneMillisecondBeforeTheStart(): void {
  const current = {
    start: new Date("2026-10-30T18:30:00.000Z"),
    end: new Date("2026-10-31T05:00:00.000Z"),
    durationHours: 10.5,
  };
  const previous = previousPeriod(current);
  expect(previous.start.toISOString()).toBe("2026-10-30T08:00:00.000Z");
  expect(previous.end.toISOString()).toBe("2026-10-30T18:29:59.999Z");
  expect(previous.durationHours).toBe(10.5);
}

export function assertCustomWithoutFromIsA400(): void {
  expectBadRequest(
    () => resolveEnergyRange({ range: "custom", to: "2026-10-31T00:00:00Z" }, zoneForArithmetic(null, "UTC"), new Date()),
    "from",
  );
}

export function assertCustomWithoutToIsA400(): void {
  expectBadRequest(
    () => resolveEnergyRange({ range: "custom", from: "2026-10-30T00:00:00Z" }, zoneForArithmetic(null, "UTC"), new Date()),
    "to",
  );
}

export function assertCustomFromNotBeforeToIsA400(): void {
  const zone = zoneForArithmetic(null, "UTC");
  const now = new Date("2026-10-31T05:00:00Z");
  expectBadRequest(
    () => resolveEnergyRange({ range: "custom", from: "2026-10-30T00:00:00Z", to: "2026-10-30T00:00:00Z" }, zone, now),
    "before",
  );
  expectBadRequest(
    () => resolveEnergyRange({ range: "custom", from: "2026-10-30T00:00:01Z", to: "2026-10-30T00:00:00Z" }, zone, now),
    "before",
  );
}

export function assertCustomOver365DaysIsA400(): void {
  const from = new Date("2025-01-01T00:00:00Z");
  const to = new Date(from.getTime() + 366 * DAY_MS);
  expectBadRequest(
    () =>
      resolveEnergyRange(
        { range: "custom", from: from.toISOString(), to: to.toISOString() },
        zoneForArithmetic(null, "UTC"),
        new Date("2026-10-31T05:00:00Z"),
      ),
    "365",
  );
}

export function assertCustomOf365DaysPasses(): void {
  const from = new Date("2025-01-01T00:00:00Z");
  const to = new Date(from.getTime() + 365 * DAY_MS);
  const range = resolveEnergyRange(
    { range: "custom", from: from.toISOString(), to: to.toISOString() },
    zoneForArithmetic(null, "UTC"),
    new Date("2026-10-31T05:00:00Z"),
  );
  expect(range.start.toISOString()).toBe(from.toISOString());
  expect(range.end.toISOString()).toBe(to.toISOString());
  expect(range.durationHours).toBe(365 * 24);
}

export function assertCustomAcceptsAnOffsetInstant(): void {
  const range = resolveEnergyRange(
    { range: "custom", from: "2026-10-30T00:00:00+05:30", to: "2026-10-31T00:00:00+05:30" },
    zoneForArithmetic(null, "UTC"),
    new Date("2026-10-31T05:00:00Z"),
  );
  expect(range.start.toISOString()).toBe("2026-10-29T18:30:00.000Z");
  expect(range.end.toISOString()).toBe("2026-10-30T18:30:00.000Z");
}

export const DISPLAY_BUCKET_ROWS: ReadonlyArray<readonly [label: string, hours: number, bucket: AggregateLevel]> = [
  ["3 h", 3, "1m"],
  ["3 h + 1 min", 3 + 1 / 60, "5m"],
  ["48 h", 48, "5m"],
  ["30 d", 30 * 24, "1h"],
  ["45 d", 45 * 24, "1h"],
  ["46 d", 46 * 24, "1d"],
  ["365 d", 365 * 24, "1d"],
];

export function assertDisplayBucketRow(hours: number, bucket: AggregateLevel): void {
  expect(displayBucketFor(hours)).toBe(bucket);
}

export function assertADayBucketReadsTheHourlyLevel(): void {
  const now = new Date("2026-10-31T05:00:00Z");
  expect(levelAndBucketFor({ bucket: "1d", olderStart: new Date(now.getTime() - 730 * DAY_MS), now })).toEqual({
    level: "1h",
    bucket: "1d",
  });
}

export function assertAFineBucketReadsItsOwnLevelInsideRetention(): void {
  const now = new Date("2026-10-31T05:00:00Z");
  expect(levelAndBucketFor({ bucket: "5m", olderStart: new Date(now.getTime() - 4 * DAY_MS), now })).toEqual({
    level: "5m",
    bucket: "5m",
  });
}

export function assertACoarsenedLevelBecomesTheBucket(): void {
  const now = new Date("2026-10-31T05:00:00Z");
  expect(levelAndBucketFor({ bucket: "1m", olderStart: new Date(now.getTime() - 740 * DAY_MS), now })).toEqual({
    level: "1h",
    bucket: "1h",
  });
}
