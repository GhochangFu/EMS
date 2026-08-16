import { BadRequestException } from "@nestjs/common";

import {
  compare,
  evaluateThresholdRule,
  evaluateTimeWindowRule,
  parseTime,
  unsupportedRuleType,
  type LatestSampleLoader,
} from "./rule-evaluation";
import type { RuleRow } from "./rules.types";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const EPOCH = new Date("2026-01-01T00:00:00.000Z");

function ruleRow(overrides: Partial<RuleRow> = {}): RuleRow {
  return {
    id: "rule-1",
    code: "RULE-1",
    name: "Feeder overload",
    description: null,
    // See `rule-mapping.spec.ts`: concern and plant domain are separate axes
    // since ADR 0031, and `category: "electrical"` is no longer a row the
    // database can hold.
    category: "safety",
    ruleType: "threshold",
    source: "operator_rule",
    enabled: true,
    assetId: "asset-1",
    assetCode: "ASSET-1",
    assetName: "Feeder 1",
    siteName: "Site A",
    assetDomain: "electrical",
    pointKey: "kw",
    operator: "gt",
    thresholdValue: 100,
    severity: "warning",
    condition: { window: "latest" },
    action: { type: "trace_only", target: "Operations" },
    lastEvaluatedAt: null,
    lifecycleStatus: "published",
    publishedAt: null,
    archivedAt: null,
    duplicatedFromRuleId: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...overrides,
  };
}

/** A loader that records whether it was consulted at all. */
function loader(
  sample: { time: Date; value: number; unit: string | null } | null,
): { load: LatestSampleLoader; calls: () => number } {
  let calls = 0;
  return {
    load: async () => {
      calls += 1;
      return sample;
    },
    calls: () => calls,
  };
}

function testCompare(): void {
  // Each operator asserted on BOTH sides of its boundary and exactly at it.
  // A test that only checks the far-from-boundary cases passes even when the
  // comparison is flipped to its non-strict twin, which is the mutation that
  // actually happens.
  assert(compare(101, "gt", 100), "gt: above must match");
  assert(!compare(100, "gt", 100), "gt: equal must NOT match");
  assert(!compare(99, "gt", 100), "gt: below must not match");

  assert(compare(101, "gte", 100), "gte: above must match");
  assert(compare(100, "gte", 100), "gte: equal MUST match");
  assert(!compare(99, "gte", 100), "gte: below must not match");

  assert(compare(99, "lt", 100), "lt: below must match");
  assert(!compare(100, "lt", 100), "lt: equal must NOT match");
  assert(!compare(101, "lt", 100), "lt: above must not match");

  assert(compare(99, "lte", 100), "lte: below must match");
  assert(compare(100, "lte", 100), "lte: equal MUST match");
  assert(!compare(101, "lte", 100), "lte: above must not match");

  assert(compare(100, "eq", 100), "eq: equal must match");
  assert(!compare(100.0001, "eq", 100), "eq: near-equal must not match");

  // Negatives and zero — a `Math.abs` or truthiness slip survives positives only.
  assert(compare(-1, "gt", -2), "gt must order negatives");
  assert(compare(0, "gte", 0), "gte must accept zero against zero");
  assert(!compare(0, "gt", 0), "gt must reject zero against zero");
}

function testParseTime(): void {
  assert(parseTime("00:00") === 0, "midnight is minute 0");
  assert(parseTime("00:01") === 1, "one past midnight is minute 1");
  assert(parseTime("01:00") === 60, "an hour is 60 minutes");
  assert(parseTime("23:59") === 1439, "the last minute of the day is 1439");
  assert(parseTime("09:30") === 570, "09:30 is 570 minutes");

  // The boundaries themselves must be accepted, and one step past rejected.
  // Without the accept-side assertions, tightening `> 23` to `>= 23` survives.
  const rejects = ["24:00", "23:60", "-1:00", "00:-1", "", "9", "aa:bb", "09:xx"];
  for (const value of rejects) {
    let threw = false;
    try {
      parseTime(value);
    } catch (error) {
      threw = error instanceof BadRequestException;
    }
    assert(threw, `parseTime must reject ${JSON.stringify(value)}`);
  }
}

async function testThresholdRule(): Promise<void> {
  const matched = await evaluateThresholdRule(
    ruleRow(),
    loader({ time: EPOCH, value: 150, unit: "kW" }).load,
  );
  assert(matched.status === "matched", "150 > 100 is a match");
  assert(matched.matched, "matched flag must agree with status");
  assert(matched.observedValue === 150, "observed value is the sample");
  assert(matched.trace.unit === "kW", "trace carries the sample unit");
  assert(
    matched.trace.sampleTime === EPOCH.toISOString(),
    "trace carries the sample time as ISO",
  );

  const notMatched = await evaluateThresholdRule(
    ruleRow(),
    loader({ time: EPOCH, value: 50, unit: "kW" }).load,
  );
  assert(notMatched.status === "not_matched", "50 > 100 is not a match");
  assert(notMatched.observedValue === 50, "a non-match still reports the value");

  // No telemetry is `skipped`, not `error` — the rule is fine, the data is absent.
  const skipped = await evaluateThresholdRule(ruleRow(), loader(null).load);
  assert(skipped.status === "skipped", "an absent sample is skipped");
  assert(skipped.observedValue === null, "skipped reports no value");

  // An incomplete rule is an error AND must never reach the database. Asserting
  // only the status would pass even if the guard ran after the query.
  for (const incomplete of [
    ruleRow({ assetId: null }),
    ruleRow({ pointKey: null }),
    ruleRow({ operator: null }),
    ruleRow({ thresholdValue: null }),
  ]) {
    const probe = loader({ time: EPOCH, value: 150, unit: "kW" });
    const result = await evaluateThresholdRule(incomplete, probe.load);
    assert(result.status === "error", "an incomplete threshold rule is an error");
    assert(probe.calls() === 0, "an incomplete rule must not query telemetry");
  }

  const complete = loader({ time: EPOCH, value: 150, unit: "kW" });
  await evaluateThresholdRule(ruleRow(), complete.load);
  assert(complete.calls() === 1, "a complete rule queries telemetry exactly once");
}

function testTimeWindowRule(): void {
  const row = (days: string[], startTime: string, endTime: string): RuleRow =>
    ruleRow({ ruleType: "time_window", condition: { days, startTime, endTime } });

  // 2026-01-07 is a Wednesday. Local time is used by the implementation, so the
  // fixtures are constructed from local components rather than a UTC string.
  const wed = (h: number, m: number) => new Date(2026, 0, 7, h, m, 0, 0);
  const thu = (h: number, m: number) => new Date(2026, 0, 8, h, m, 0, 0);

  const inside = evaluateTimeWindowRule(row(["wed"], "09:00", "17:00"), wed(12, 0));
  assert(inside.status === "matched", "midday is inside 09:00-17:00 on Wednesday");

  const before = evaluateTimeWindowRule(row(["wed"], "09:00", "17:00"), wed(8, 59));
  assert(before.status === "not_matched", "08:59 is outside a 09:00 start");

  // Both ends are inclusive. Flipping either `>=`/`<=` to strict is caught here.
  const atStart = evaluateTimeWindowRule(row(["wed"], "09:00", "17:00"), wed(9, 0));
  assert(atStart.status === "matched", "the start minute is inside the window");
  const atEnd = evaluateTimeWindowRule(row(["wed"], "09:00", "17:00"), wed(17, 0));
  assert(atEnd.status === "matched", "the end minute is inside the window");
  const afterEnd = evaluateTimeWindowRule(row(["wed"], "09:00", "17:00"), wed(17, 1));
  assert(afterEnd.status === "not_matched", "one minute past the end is outside");

  // The right day at the right time, and the wrong day at the right time.
  const wrongDay = evaluateTimeWindowRule(row(["mon"], "09:00", "17:00"), wed(12, 0));
  assert(wrongDay.status === "not_matched", "Wednesday is not Monday");

  // A window that wraps past midnight flips the comparison from and to or.
  const overnight = row(["wed"], "22:00", "06:00");
  assert(
    evaluateTimeWindowRule(overnight, wed(23, 0)).status === "matched",
    "23:00 is inside an overnight 22:00-06:00 window",
  );
  assert(
    evaluateTimeWindowRule(overnight, wed(2, 0)).status === "matched",
    "02:00 is inside an overnight window (the day is still Wednesday)",
  );
  assert(
    evaluateTimeWindowRule(overnight, wed(12, 0)).status === "not_matched",
    "midday is outside an overnight window",
  );

  // The day is the day of the instant, not of the window's start — an overnight
  // window on Wednesday does not match Thursday morning.
  assert(
    evaluateTimeWindowRule(overnight, thu(2, 0)).status === "not_matched",
    "Thursday 02:00 does not match a Wednesday overnight window",
  );

  // The trace must report the instant actually evaluated, not the current time.
  const traced = evaluateTimeWindowRule(row(["wed"], "09:00", "17:00"), wed(12, 34));
  assert(traced.trace.day === "wed", "trace names the evaluated day");
  assert(traced.trace.minuteOfDay === 754, "trace carries 12:34 as minute 754");

  // A threshold-shaped condition on a time-window rule is an error, not a crash.
  const wrongShape = evaluateTimeWindowRule(
    ruleRow({ ruleType: "time_window", condition: { window: "latest" } }),
    wed(12, 0),
  );
  assert(wrongShape.status === "error", "a non-window condition is an error");
  assert(!wrongShape.matched, "an error never reports a match");
}

function testUnsupported(): void {
  const result = unsupportedRuleType(ruleRow({ ruleType: "anomaly" }));
  assert(result.status === "error", "an unknown rule type is an error");
  assert(
    result.message.includes("anomaly"),
    "the message names the unsupported type so the trace is actionable",
  );
  assert(result.trace.ruleType === "anomaly", "the trace carries the type");
}

/** Assertions for the rule engine's pure decision logic (ADR 0014, §4.6). */
export async function runRuleEvaluationTests(): Promise<void> {
  testCompare();
  testParseTime();
  await testThresholdRule();
  testTimeWindowRule();
  testUnsupported();
}
