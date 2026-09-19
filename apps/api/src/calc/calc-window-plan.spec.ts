import type { AggregateLevel } from "../telemetry/point-aggregates";
import {
  bucketCount,
  budgetDefect,
  combineSegments,
  deltaOf,
  hoursOf,
  LEVEL_MS,
  MAX_LIVE_MINUTES,
  MAX_WINDOW_BUCKETS,
  planWindowSegments,
  rollingStartMs,
  WINDOW_LEVELS,
  windowEndMs,
  type Segment,
  type Watermarks,
} from "./calc-window-plan";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const utc = (iso: string): number => Date.parse(iso);

/** A compact rendering of a plan for assertion messages: `5m 18:30–19:00`. */
function render(segments: readonly Segment[]): string {
  const hhmm = (ms: number): string => new Date(ms).toISOString().slice(5, 16).replace("T", " ");
  return segments.map((s) => `${s.level} ${hhmm(s.fromMs)}–${hhmm(s.toMs)}`).join(" | ");
}

function marks(m: { "1d": string; "1h": string; "5m": string; "1m": string }): Watermarks {
  return {
    "1d": utc(m["1d"]),
    "1h": utc(m["1h"]),
    "5m": utc(m["5m"]),
    "1m": utc(m["1m"]),
  };
}

/** A small deterministic PRNG (mulberry32) so P7's cases are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `planWindowSegments` — the pure half of ADR 0070 decision 5's view
 * selection (`E4.1b` plan design decision 5): the coarsest ALIGNED level whose
 * watermark has passed, composed with finer levels for the head and the tail,
 * `1m` always finishing. Every case is built with `Date.UTC`/ISO strings; no
 * local-time constructor appears, so the machine's zone cannot leak in. One
 * exported function per claim, so a mutation reddens the assertion that owns
 * it and not only the first block in a shared body.
 */
const D = "2026-09-17";

/** P1 — an IST day (18:30Z start) at 20:30Z, every watermark behind the end */
export function runWindowPlanIstDayTests(): void {
  const plan = planWindowSegments({
    startMs: utc(`${D}T18:30:00Z`),
    endMs: utc(`${D}T20:30:00Z`),
    watermarks: marks({
      "1d": `${D}T00:00:00Z`,
      "1h": `${D}T20:00:00Z`,
      "5m": `${D}T20:20:00Z`,
      "1m": `${D}T20:29:00Z`,
    }),
  });
  assert(
    render(plan) ===
      "5m 09-17 18:30–09-17 19:00 | 1h 09-17 19:00–09-17 20:00 | 5m 09-17 20:00–09-17 20:20 | 1m 09-17 20:20–09-17 20:30",
    `P1: an IST day composes 5m, 1h, 5m, 1m — got ${render(plan)}`,
  );
}

/** P2 — the same window with the 1h watermark behind the start: no 1h segment */
export function runWindowPlanStaleWatermarkTests(): void {
  const plan = planWindowSegments({
    startMs: utc(`${D}T18:30:00Z`),
    endMs: utc(`${D}T20:30:00Z`),
    watermarks: marks({
      "1d": `${D}T00:00:00Z`,
      "1h": `${D}T18:00:00Z`,
      "5m": `${D}T20:20:00Z`,
      "1m": `${D}T20:29:00Z`,
    }),
  });
  assert(
    render(plan) === "5m 09-17 18:30–09-17 20:20 | 1m 09-17 20:20–09-17 20:30",
    `P2: a stale 1h watermark drops to 5m — got ${render(plan)}`,
  );
}

/** P3 — a SAST day (22:00Z start): 1h segments, never 1d */
export function runWindowPlanSastDayTests(): void {
  const plan = planWindowSegments({
    startMs: utc(`${D}T22:00:00Z`),
    endMs: utc(`2026-09-18T09:00:00Z`),
    watermarks: marks({
      "1d": `${D}T00:00:00Z`,
      "1h": `2026-09-18T08:00:00Z`,
      "5m": `2026-09-18T08:50:00Z`,
      "1m": `2026-09-18T08:59:00Z`,
    }),
  });
  assert(
    render(plan) === "1h 09-17 22:00–09-18 08:00 | 5m 09-18 08:00–09-18 08:50 | 1m 09-18 08:50–09-18 09:00",
    `P3: a SAST day is 1h plus tails, never 1d (the 1d watermark is behind the start) — got ${render(plan)}`,
  );
  assert(!plan.some((s) => s.level === "1d"), "P3: no 1d segment inside a partial day");
}

/** P4 — a UTC this_month on the 20th, the 1d watermark on the 18th */
export function runWindowPlanMonthTests(): void {
  const plan = planWindowSegments({
    startMs: utc("2026-09-01T00:00:00Z"),
    endMs: utc("2026-09-20T10:30:00Z"),
    watermarks: marks({
      "1d": "2026-09-18T00:00:00Z",
      "1h": "2026-09-20T08:00:00Z",
      "5m": "2026-09-20T10:20:00Z",
      "1m": "2026-09-20T10:29:00Z",
    }),
  });
  assert(
    render(plan) ===
      "1d 09-01 00:00–09-18 00:00 | 1h 09-18 00:00–09-20 08:00 | 5m 09-20 08:00–09-20 10:20 | 1m 09-20 10:20–09-20 10:30",
    `P4: the month is 1d to the watermark, then 1h, 5m and 1m to the end — got ${render(plan)}`,
  );
  assert(
    plan[plan.length - 1].toMs === utc("2026-09-20T10:30:00Z"),
    "P4: the plan reaches the window's end, not the 1d watermark",
  );
}

/** P5 — a rolling 24h at a minute-aligned end */
export function runWindowPlanRollingTests(): void {
  const endMs = utc(`${D}T14:07:00Z`);
  const plan = planWindowSegments({
    startMs: rollingStartMs(endMs, 1440),
    endMs,
    watermarks: marks({
      "1d": `${D}T00:00:00Z`,
      "1h": `${D}T12:00:00Z`,
      "5m": `${D}T13:55:00Z`,
      "1m": `${D}T14:06:00Z`,
    }),
  });
  assert(
    render(plan) ===
      "1m 09-16 14:07–09-16 14:10 | 5m 09-16 14:10–09-16 15:00 | 1h 09-16 15:00–09-17 12:00 | 5m 09-17 12:00–09-17 13:55 | 1m 09-17 13:55–09-17 14:07",
    `P5: a rolling 24h — a 1m head to the first 5m edge, 5m to the hour, 1h to its watermark, 5m and 1m tails — got ${render(plan)}`,
  );
  // the 1d watermark sits exactly on the one day boundary inside the window,
  // so a 1d segment would be empty; none is emitted
  assert(!plan.some((s) => s.level === "1d"), "P5: no empty 1d segment");
}

/** P6 — an empty window */
export function runWindowPlanEmptyTests(): void {
  const t = utc(`${D}T10:00:00Z`);
  const plan = planWindowSegments({
    startMs: t,
    endMs: t,
    watermarks: marks({
      "1d": `${D}T00:00:00Z`,
      "1h": `${D}T09:00:00Z`,
      "5m": `${D}T09:55:00Z`,
      "1m": `${D}T09:59:00Z`,
    }),
  });
  assert(plan.length === 0, `P6: start === end plans nothing, got ${render(plan)}`);
}

/** P7 — a seeded tiling property, 2,000 cases */
export function runWindowPlanTilingProperty(): void {
  const random = rng(0xe41b);
  const base = utc("2026-01-01T00:00:00Z");
  const finer: Record<AggregateLevel, AggregateLevel | null> = {
    "1d": "1h",
    "1h": "5m",
    "5m": "1m",
    "1m": null,
  };
  for (let i = 0; i < 2000; i += 1) {
    const endMs = base + Math.floor(random() * 400 * 1440) * 60_000; // a minute-aligned end within 400 days
    const minutes = 1 + Math.floor(random() * 366 * 1440);
    const startMs = rollingStartMs(endMs, minutes);
    // each watermark somewhere in [end − 3d, end + 1h), independently
    const w = (): number => endMs - Math.floor(random() * (3 * 1440 + 60)) * 60_000 + 60 * 60_000;
    const watermarks: Watermarks = {
      "1d": w(),
      "1h": w(),
      "5m": w(),
      "1m": w(),
    };
    const plan = planWindowSegments({ startMs, endMs, watermarks });
    const label = `P7 #${i} [${new Date(startMs).toISOString()}, ${new Date(endMs).toISOString()}) w=${JSON.stringify(watermarks)}`;
    assert(plan.length > 0, `${label}: a non-empty window has at least one segment`);
    assert(
      plan[0].fromMs === startMs && plan[plan.length - 1].toMs === endMs,
      `${label}: the plan spans the window exactly — ${render(plan)}`,
    );
    for (let k = 0; k < plan.length; k += 1) {
      const s = plan[k];
      assert(s.toMs > s.fromMs, `${label}: segment ${k} is non-empty`);
      assert(
        s.fromMs % LEVEL_MS[s.level] === 0 && s.toMs % LEVEL_MS[s.level] === 0,
        `${label}: segment ${k} is aligned to ${s.level} — ${render(plan)}`,
      );
      if (s.level !== "1m") {
        assert(
          s.toMs <= watermarks[s.level],
          `${label}: segment ${k} at ${s.level} ends at or before its watermark — ${render(plan)}`,
        );
      }
      if (k > 0) {
        assert(plan[k - 1].toMs === s.fromMs, `${label}: segments are contiguous — ${render(plan)}`);
        assert(plan[k - 1].level !== s.level, `${label}: two adjacent segments never share a level — ${render(plan)}`);
      }
      assert(finer[s.level] !== undefined, "every level is one of the four");
    }
  }
}

/** P8 — combineSegments: sum is the time integral, never Σ sum_value */
export function runCombineSegmentsTests(): void {
  const rows = [
    { sumValue: 1000, sampleCount: 10, minValue: 100, maxValue: 100 },
    { sumValue: 200, sampleCount: 1, minValue: 200, maxValue: 200 },
  ];
  const sum = combineSegments("sum", rows, 24);
  assert(
    sum.ok === true && Math.abs(sum.value - 2618.181818) < 1e-6,
    `P8: sum is avg × hours = 2618.18…, got ${JSON.stringify(sum)}`,
  );
  assert(sum.ok === true && sum.value !== 1200, "P8: sum is NOT Σ sum_value (1200)");
  const avg = combineSegments("avg", rows, 24);
  assert(
    avg.ok === true && Math.abs(avg.value - 109.090909) < 1e-6,
    `P8: avg is Σsum / Σcount = 109.09…, got ${JSON.stringify(avg)}`,
  );
  const min = combineSegments("min", rows, 24);
  assert(min.ok === true && min.value === 100, `P8: min, got ${JSON.stringify(min)}`);
  const max = combineSegments("max", rows, 24);
  assert(max.ok === true && max.value === 200, `P8: max, got ${JSON.stringify(max)}`);

  // a segment with no rows contributes nothing and nulls are skipped
  const withEmpty = combineSegments(
    "min",
    [{ sumValue: null, sampleCount: 0, minValue: null, maxValue: null }, ...rows],
    24,
  );
  assert(withEmpty.ok === true && withEmpty.value === 100, "P8: an empty segment beside full ones is ignored");

  const empty = combineSegments("avg", [{ sumValue: null, sampleCount: 0, minValue: null, maxValue: null }], 24);
  assert(
    empty.ok === false && empty.reason === "window_empty",
    `P8: Σcount 0 is window_empty, got ${JSON.stringify(empty)}`,
  );
  const none = combineSegments("sum", [], 24);
  assert(none.ok === false && none.reason === "window_empty", "P8: no segments at all is window_empty");
}

/** P9 — deltaOf: last minus first; one sample or none is empty */
export function runDeltaOfTests(): void {
  const two = deltaOf({ timeMs: 1, value: 130 }, { timeMs: 5, value: 200 });
  assert(two.ok === true && two.value === 70, `P9: 200 − 130 = 70, got ${JSON.stringify(two)}`);
  const one = deltaOf({ timeMs: 3, value: 130 }, { timeMs: 3, value: 130 });
  assert(one.ok === false && one.reason === "window_empty", "P9: one sample (first === last) is window_empty");
  const none = deltaOf(null, null);
  assert(none.ok === false && none.reason === "window_empty", "P9: no sample is window_empty");
  const negative = deltaOf({ timeMs: 1, value: 10 }, { timeMs: 2, value: 4 });
  assert(
    negative.ok === true && negative.value === -6,
    "P9: a decreasing counter gives a negative delta (the author's problem, not a refusal)",
  );
}

/** P10 — windowEndMs floors the tick's bucket to the minute */
export function runWindowBoundsTests(): void {
  const t = utc(`${D}T12:34:56.789Z`);
  assert(windowEndMs(t, 60) === utc(`${D}T12:34:00Z`), "P10: a 60 s interval is bucketTimeMs");
  assert(windowEndMs(t, 300) === utc(`${D}T12:30:00Z`), "P10: a 300 s interval is bucketTimeMs");
  assert(windowEndMs(t, 30) === utc(`${D}T12:34:00Z`), "P10: a 30 s interval floors to the minute, not to :34:30");
  assert(windowEndMs(t, 10) === utc(`${D}T12:34:00Z`), "P10: a 10 s interval floors to the minute");
  assert(hoursOf(utc(`${D}T18:30:00Z`), utc(`${D}T20:30:00Z`)) === 2, "P10: hoursOf is elapsed hours");
  assert(hoursOf(0, 90 * 60_000) === 1.5, "P10: hoursOf is fractional");
  assert(
    rollingStartMs(utc(`${D}T00:00:00Z`), 1440) === utc("2026-09-16T00:00:00Z"),
    "P10: rollingStartMs subtracts minutes",
  );
  assert(WINDOW_LEVELS.join(",") === "1d,1h,5m,1m", "the ladder is coarse to fine");
}

/** P11 — the two budgets a stalled policy is refused against (security review M1, ruled fail closed) */
export function runBucketBudgetTests(): void {
  const end = utc("2026-09-19T10:00:00Z");
  const year = rollingStartMs(end, 366 * 1440);
  const healthy = marks({ "1d": "2026-09-19T00:00:00Z", "1h": "2026-09-19T08:00:00Z", "5m": "2026-09-19T09:50:00Z", "1m": "2026-09-19T09:59:00Z" });
  const healthyYear = planWindowSegments({ startMs: year, endMs: end, watermarks: healthy });
  assert(bucketCount(healthyYear) < 500, `P11: a 366d read under healthy watermarks folds ~366 day buckets plus tails, got ${bucketCount(healthyYear)}`);
  assert(budgetDefect(healthyYear, end, healthy) === null, "P11: a healthy 366d read is inside both budgets");

  // the 1d policy never ran and 1h stalled a year: the year falls to 5m
  const coarseStalled = marks({ "1d": "2025-01-01T00:00:00Z", "1h": "2025-01-01T00:00:00Z", "5m": "2026-09-19T09:50:00Z", "1m": "2026-09-19T09:59:00Z" });
  const coarseYear = planWindowSegments({ startMs: year, endMs: end, watermarks: coarseStalled });
  assert(bucketCount(coarseYear) > MAX_WINDOW_BUCKETS, `P11: a 366d read on stalled coarse policies exceeds the bucket budget (${bucketCount(coarseYear)})`);
  const coarseDefect = budgetDefect(coarseYear, end, coarseStalled);
  assert(coarseDefect !== null && /buckets over the 20000 budget/.test(coarseDefect) && /1d 2025-01-01/.test(coarseDefect), `P11: the bucket budget names itself and the watermarks, got ${coarseDefect}`);
  // a 24h read on the same stalled policies is served: the bucket budget bites on length, not on the stall alone
  const coarseDay = planWindowSegments({ startMs: rollingStartMs(end, 1440), endMs: end, watermarks: coarseStalled });
  assert(budgetDefect(coarseDay, end, coarseStalled) === null, `P11: a 24h read on stalled coarse policies is inside both budgets, got ${budgetDefect(coarseDay, end, coarseStalled)}`);

  // a blocked refresh stalls ALL four a week: the bucket count stays small
  // (1d still serves the past) but a week beyond the 1m watermark is raw
  const allStalled = marks({ "1d": "2026-09-12T00:00:00Z", "1h": "2026-09-12T00:00:00Z", "5m": "2026-09-12T00:00:00Z", "1m": "2026-09-12T00:00:00Z" });
  const allYear = planWindowSegments({ startMs: year, endMs: end, watermarks: allStalled });
  assert(bucketCount(allYear) <= MAX_WINDOW_BUCKETS, `P11: the bucket budget alone would admit a blocked refresh (${bucketCount(allYear)})`);
  const liveDefect = budgetDefect(allYear, end, allStalled);
  assert(liveDefect !== null && /minutes of raw rows beyond the 1m watermark/.test(liveDefect) && /1m 2026-09-12/.test(liveDefect), `P11: the live budget refuses a blocked refresh and names the 1m watermark, got ${liveDefect}`);
  // …and so is a 24h read: every aggregate window read stops, which is what surfaces the stall
  const allDay = planWindowSegments({ startMs: rollingStartMs(end, 1440), endMs: end, watermarks: allStalled });
  assert(budgetDefect(allDay, end, allStalled) !== null, "P11: a 24h read on a blocked refresh is refused too");
  // a healthy stack's live part is minutes, far inside the budget
  const healthyDay = planWindowSegments({ startMs: rollingStartMs(end, 1440), endMs: end, watermarks: healthy });
  assert(budgetDefect(healthyDay, end, healthy) === null, "P11: a healthy 24h read is inside both budgets");

  assert(bucketCount([]) === 0, "P11: no segments fold no buckets");
  assert(bucketCount([{ level: "1h", fromMs: 0, toMs: 7_200_000 }]) === 2, "P11: two hour buckets");
  assert(MAX_WINDOW_BUCKETS === 20_000 && MAX_LIVE_MINUTES === 180, "the budgets the cases above are written against");
}
