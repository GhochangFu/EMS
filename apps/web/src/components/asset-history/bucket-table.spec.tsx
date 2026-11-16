import { render, screen } from "@testing-library/react";
import type { PointAggregateResponse } from "@bms/shared";
import { expect } from "vitest";

import { BucketTable } from "./bucket-table";

/**
 * `F4.379` (the owner's AWS check, 2026-11-16) — the bucket table's Min and Max are stored readings,
 * so they print as the Latest cell does (`formatReading`): the float's binary tail dropped, every
 * real digit kept. A WBLDC cold room's value is an int16 × 0.1, and a fourth decimal a sensor sends
 * (0.0125) is not rounded to three. Average and Previous period are computed means: three decimals.
 * Entry point: `bucket-table.test.tsx`.
 */
function data(bucket: { min: number; average: number; max: number }): PointAggregateResponse {
  return {
    pointRef: "ref",
    from: "2026-10-31T00:00:00.000Z",
    to: "2026-10-31T01:00:00.000Z",
    bucketSeconds: 3600,
    stats: { sum: null, average: null, min: null, max: null, peakAt: null, sampleCount: 0 },
    compare: null,
    buckets: [{ t: "2026-10-31T00:00:00.000Z", v: bucket.average, ...bucket, sampleCount: 4 }],
  };
}

function cells(bucket: { min: number; average: number; max: number }): string[] {
  render(<BucketTable pointKey="temp" unit="°C" data={data(bucket)} compare={false} zone="Etc/UTC" />);
  const row = screen.getAllByRole("row")[1];
  return Array.from(row.children).map((cell) => cell.textContent ?? "");
}

/** Min and Max drop float noise: `-6.3999999999999995` → `-6.4`, `0.3000000000000007` → `0.3`. */
export function minAndMaxDropFloatNoise(): void {
  const [, min, average, max] = cells({ min: -6.3999999999999995, average: -2.0000000000000004, max: 0.3000000000000007 });
  expect([min, average, max]).toEqual(["-6.4", "-2", "0.3"]);
}

/** Min and Max keep a real fourth decimal; the mean keeps three. */
export function minAndMaxKeepRealDigits(): void {
  const [, min, average, max] = cells({ min: 0.0125, average: 0.01875, max: 49.9625 });
  expect([min, average, max]).toEqual(["0.0125", "0.019", "49.9625"]);
}
