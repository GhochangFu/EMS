import { expect } from "vitest";

import type { PlanWarning } from "./bindings.js";
import { createPlanWarningReporter, createReloadSkipReporter, oncePerKey } from "./once-per-key.js";

/**
 * `F1.2` plan T3.7 — the once-per-process warning report `main.ts` uses at
 * boot and at every reload. Assertions live here; `once-per-key.test.ts` is
 * the vitest entry point.
 */

type Line = { message: string; fields?: Record<string, unknown> };

function capture() {
  const lines: Line[] = [];
  const logger = {
    info: () => undefined,
    warn: (message: string, fields?: Record<string, unknown>) => {
      lines.push(fields === undefined ? { message } : { message, fields });
    },
    error: () => undefined,
  };
  return { lines, report: createPlanWarningReporter(logger) };
}

const fallback = (rtuId: string): PlanWarning => ({ rtuId, rtuCode: rtuId.toUpperCase(), reason: "credential-env-fallback" });
const interval = (rtuId: string, detail: "endpoint" | "organization"): PlanWarning => ({
  rtuId,
  rtuCode: rtuId.toUpperCase(),
  reason: "poll-interval-out-of-bounds",
  detail,
});

export function assertAKeyIsTrueOnlyTheFirstTime(): void {
  const first = oncePerKey();
  expect([first("a"), first("a"), first("b"), first("a")]).toEqual([true, false, true, false]);
  // Two predicates do not share memory.
  expect(oncePerKey()("a")).toBe(true);
}

export function assertAnUnchangedWarningIsReportedOnce(): void {
  const { lines, report } = capture();
  report([fallback("r1")]);
  report([fallback("r1")]);
  report([fallback("r1")]);
  expect(lines).toHaveLength(1);
  expect(lines[0]?.message).toBe("rtu credential fallback");
}

export function assertAWarningFirstSeenAtAReloadIsReported(): void {
  const { lines, report } = capture();
  report([]);
  report([fallback("r2")]);
  expect(lines.map((l) => l.fields?.rtuId)).toEqual(["r2"]);
}

export function assertEachReasonAndLevelIsItsOwnKey(): void {
  const { lines, report } = capture();
  report([fallback("r1"), interval("r1", "endpoint")]);
  report([interval("r1", "endpoint"), interval("r1", "organization")]);
  expect(lines.map((l) => [l.message, l.fields?.level])).toEqual([
    ["rtu credential fallback", undefined],
    ["rtu poll interval out of bounds", "endpoint"],
    ["rtu poll interval out of bounds", "organization"],
  ]);
}

export function assertAnIntervalLineNamesTheLevelAndNoValue(): void {
  const { lines, report } = capture();
  report([interval("r1", "organization")]);
  expect(lines[0]?.fields).toEqual({
    rtuCode: "R1",
    rtuId: "r1",
    reason: "poll-interval-out-of-bounds",
    level: "organization",
  });
}

/** ADR 0141 decision 22: a named skip first seen at a reload is logged once; one seen at boot is not repeated. */
export function assertANamedReloadSkipIsLoggedOnce(): void {
  const lines: Line[] = [];
  const logger = {
    info: () => undefined,
    warn: (message: string, fields?: Record<string, unknown>) => lines.push(fields === undefined ? { message } : { message, fields }),
    error: () => undefined,
  };
  const skips = createReloadSkipReporter(logger, new Set(["modbus-host-not-allowed"]));
  const skip = (rtuId: string, reason: string) => ({ rtuId, rtuCode: rtuId.toUpperCase(), reason });
  skips.boot([skip("r1", "modbus-host-not-allowed")]);
  skips.reload([skip("r1", "modbus-host-not-allowed"), skip("r2", "modbus-host-not-allowed"), skip("r3", "no-adapter")]);
  skips.reload([skip("r2", "modbus-host-not-allowed")]);
  expect(lines).toEqual([
    { message: "rtu skipped", fields: { rtuCode: "R2", rtuId: "r2", reason: "modbus-host-not-allowed" } },
  ]);
}

