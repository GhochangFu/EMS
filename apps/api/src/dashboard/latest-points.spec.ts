import { LATEST_DAY_ARMS_MAX, planLatestPoints, type LatestPair } from "./latest-points";

/**
 * `F4.390` (plan §3 Task 1.1, D2) — the pure half of the Assets tab latest read: the SQL text
 * `planLatestPoints` builds from the discovered `(asset, key, last day)` pairs. Each arm must bound
 * its raw read by two SQL-text day literals, never a bound parameter, so the planner excludes every
 * chunk but one or two. The database half (discovery, and old read = new read on committed rows)
 * is `latest-points.integration.spec.ts`.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";

/** A time bound that compares against a bound parameter — the shape D2 forbids. */
const PARAMETER_TIME_BOUND = /\btime\s*[<>]=?\s*[^'\n]*\$\d/;

function pair(assetId: string, pointKey: string, lastDay: string): LatestPair {
  return { assetId, pointKey, lastDay };
}

function lowerBound(day: string): string {
  return `v.time >= timestamptz '${day} 00:00:00+00'`;
}

function upperBound(day: string): string {
  return `v.time < timestamptz '${day} 00:00:00+00'`;
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The `latest_points` CTE body, split into its `UNION ALL` arms. */
function arms(cteSql: string): string[] {
  const at = cteSql.indexOf("latest_points AS (");
  assert(at >= 0, `cteSql must define latest_points, got:\n${cteSql}`);
  return cteSql.slice(at).split(/\bUNION ALL\b/);
}

function parameterNumbers(sql: string): number[] {
  return [...new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))].sort((x, y) => x - y);
}

/** The group each `(asset, key)` was given, read back from the three parallel parameter arrays. */
function groupOf(params: readonly [readonly string[], readonly string[], readonly number[]], assetId: string, pointKey: string): number | undefined {
  const [assetIds, pointKeys, groups] = params;
  for (let i = 0; i < assetIds.length; i += 1) {
    if (assetIds[i] === assetId && pointKeys[i] === pointKey) {
      return groups[i];
    }
  }
  return undefined;
}

/**
 * Two days in: one arm per day, newest first, each bounded by its own day literals; one raw read
 * per arm; no bound-parameter time bound; three equal-length parameter arrays numbered from
 * `firstParam`.
 */
export function assertTwoDaysMakeTwoLiteralBoundedArms(): void {
  const pairs = [
    pair(A, "kw", "2026-11-18"),
    pair(A, "pf", "2026-11-19"),
    pair(B, "kw", "2026-11-19"),
  ];
  const plan = planLatestPoints(pairs, 2);
  const parts = arms(plan.cteSql);

  assert(parts.length === 2, `two days must make two arms, got ${parts.length}:\n${plan.cteSql}`);
  assert(
    count(plan.cteSql, "FROM telemetry.point_values v") === 2,
    `each arm reads point_values exactly once, got ${count(plan.cteSql, "FROM telemetry.point_values v")}`,
  );
  for (const [i, arm] of parts.entries()) {
    assert(count(arm, "FROM telemetry.point_values v") === 1, `arm ${i} must read point_values once:\n${arm}`);
    assert(arm.includes(`p.grp = ${i}`), `arm ${i} must select group ${i}:\n${arm}`);
    assert(arm.includes("ORDER BY v.time DESC LIMIT 1"), `arm ${i} must keep the newest sample:\n${arm}`);
  }

  // Newest day first: group 0 is 2026-11-19, group 1 is 2026-11-18.
  assert(parts[0].includes(lowerBound("2026-11-19")), `arm 0 lower bound:\n${parts[0]}`);
  assert(parts[0].includes(upperBound("2026-11-20")), `arm 0 upper bound:\n${parts[0]}`);
  assert(parts[1].includes(lowerBound("2026-11-18")), `arm 1 lower bound:\n${parts[1]}`);
  assert(parts[1].includes(upperBound("2026-11-19")), `arm 1 upper bound:\n${parts[1]}`);

  assert(
    !PARAMETER_TIME_BOUND.test(plan.cteSql),
    `no time bound may compare against a bound parameter:\n${plan.cteSql}`,
  );

  const params = plan.params;
  assert(params.length === 3, `params must be three arrays, got ${params.length}`);
  assert(
    params[0].length === 3 && params[1].length === 3 && params[2].length === 3,
    `params must be three arrays of one entry per pair, got ${JSON.stringify(params)}`,
  );
  assert(
    JSON.stringify([...new Set(params[2])].sort()) === JSON.stringify([0, 1]),
    `groups must be 0 and 1, got ${JSON.stringify(params[2])}`,
  );
  assert(groupOf(params, A, "pf") === 0, `A/pf (2026-11-19) must be group 0, got ${groupOf(params, A, "pf")}`);
  assert(groupOf(params, B, "kw") === 0, `B/kw (2026-11-19) must be group 0, got ${groupOf(params, B, "kw")}`);
  assert(groupOf(params, A, "kw") === 1, `A/kw (2026-11-18) must be group 1, got ${groupOf(params, A, "kw")}`);

  assert(
    JSON.stringify(parameterNumbers(plan.cteSql)) === JSON.stringify([2, 3, 4]),
    `firstParam 2 must name exactly $2, $3, $4, got ${JSON.stringify(parameterNumbers(plan.cteSql))}`,
  );
  const fromOne = planLatestPoints(pairs, 1);
  assert(
    JSON.stringify(parameterNumbers(fromOne.cteSql)) === JSON.stringify([1, 2, 3]),
    `firstParam 1 must name exactly $1, $2, $3, got ${JSON.stringify(parameterNumbers(fromOne.cteSql))}`,
  );
}

/**
 * Nine distinct days in: exactly `LATEST_DAY_ARMS_MAX` (6) arms. The five newest days keep an arm
 * each; the last arm takes every older day, from the oldest day to the newest of the rest + 1 day.
 * The days cross a month and a year so the next-day arithmetic is exercised.
 */
export function assertManyDaysMergeIntoTheLastArm(): void {
  assert(LATEST_DAY_ARMS_MAX === 6, `LATEST_DAY_ARMS_MAX must be 6, got ${LATEST_DAY_ARMS_MAX}`);

  // Deliberately out of order: the builder sorts.
  const days = [
    "2026-03-01",
    "2026-11-02",
    "2025-06-15",
    "2026-11-19",
    "2026-09-30",
    "2026-10-31",
    "2025-12-31",
    "2026-11-10",
    "2026-11-18",
  ];
  const pairs = days.map((day, i) => pair(i % 2 === 0 ? A : B, `key_${day}`, day));
  const plan = planLatestPoints(pairs, 2);
  const parts = arms(plan.cteSql);

  assert(parts.length === LATEST_DAY_ARMS_MAX, `nine days must make ${LATEST_DAY_ARMS_MAX} arms, got ${parts.length}`);

  const own: [string, string][] = [
    ["2026-11-19", "2026-11-20"],
    ["2026-11-18", "2026-11-19"],
    ["2026-11-10", "2026-11-11"],
    ["2026-11-02", "2026-11-03"],
    ["2026-10-31", "2026-11-01"],
  ];
  for (const [i, [from, to]] of own.entries()) {
    assert(parts[i].includes(lowerBound(from)), `arm ${i} must start at ${from}:\n${parts[i]}`);
    assert(parts[i].includes(upperBound(to)), `arm ${i} must end before ${to}:\n${parts[i]}`);
  }
  for (const [i, [from]] of own.entries()) {
    const assetId = pairs.find((p) => p.lastDay === from)!.assetId;
    const got = groupOf(plan.params, assetId, `key_${from}`);
    assert(got === i, `key_${from} must be group ${i}, got ${got}`);
  }

  const last = parts[LATEST_DAY_ARMS_MAX - 1];
  assert(last.includes(lowerBound("2025-06-15")), `the merged arm must start at the oldest day:\n${last}`);
  assert(
    last.includes(upperBound("2026-10-01")),
    `the merged arm must end the day after the newest of the rest (2026-09-30):\n${last}`,
  );
  assert(last.includes(`p.grp = ${LATEST_DAY_ARMS_MAX - 1}`), `the merged arm must select the last group:\n${last}`);
  for (const day of ["2026-09-30", "2026-03-01", "2025-12-31", "2025-06-15"]) {
    const assetId = pairs.find((p) => p.lastDay === day)!.assetId;
    const got = groupOf(plan.params, assetId, `key_${day}`);
    assert(got === LATEST_DAY_ARMS_MAX - 1, `key_${day} must be in the merged group, got ${got}`);
  }
  assert(!PARAMETER_TIME_BOUND.test(plan.cteSql), `no time bound may compare against a bound parameter`);
}

/** The next day rolls the month, the year and a leap February. */
export function assertNextDayRollsCalendarBoundaries(): void {
  const cases: [string, string][] = [
    ["2025-12-31", "2026-01-01"],
    ["2028-02-28", "2028-02-29"],
    ["2028-02-29", "2028-03-01"],
    ["2026-02-28", "2026-03-01"],
  ];
  for (const [day, next] of cases) {
    const plan = planLatestPoints([pair(A, "kw", day)], 2);
    assert(plan.cteSql.includes(lowerBound(day)), `${day}: lower bound missing:\n${plan.cteSql}`);
    assert(plan.cteSql.includes(upperBound(next)), `${day}: upper bound must be ${next}:\n${plan.cteSql}`);
  }
}

/**
 * No pairs: `latest_pairs` still names all three parameters (a statement naming fewer parameters
 * than are bound fails at Bind), and `latest_points` is the typed empty select.
 */
export function assertNoPairsStillNamesEveryParameter(): void {
  const plan = planLatestPoints([], 2);
  const flat = plan.cteSql.replace(/\s+/g, " ");

  assert(
    JSON.stringify(parameterNumbers(plan.cteSql)) === JSON.stringify([2, 3, 4]),
    `the empty plan must still name $2, $3, $4, got ${JSON.stringify(parameterNumbers(plan.cteSql))}`,
  );
  assert(
    JSON.stringify(plan.params) === JSON.stringify([[], [], []]),
    `the empty plan binds three empty arrays, got ${JSON.stringify(plan.params)}`,
  );
  assert(
    flat.includes(
      "latest_points AS ( SELECT p.asset_id, p.point_key, NULL::float8 AS value, NULL::varchar AS unit, NULL::timestamptz AS time FROM latest_pairs p WHERE false )",
    ),
    `the empty latest_points must be the typed WHERE false select, got:\n${plan.cteSql}`,
  );
  assert(!flat.includes("telemetry.point_values"), `the empty plan reads no telemetry:\n${plan.cteSql}`);
}

/** A day that is not `YYYY-MM-DD`, or not a real date, throws before any SQL text exists (§4.4). */
export function assertBadDayThrows(): void {
  const bad = ["2026-11-19'; --", "2026-13-40", "2026-02-29", "26-11-19", "2026-11-19 00:00:00+00", ""];
  for (const day of bad) {
    let threw = false;
    try {
      // One valid pair first, so validation is not only of the first entry.
      planLatestPoints([pair(A, "kw", "2026-11-19"), pair(B, "kw", day)], 2);
    } catch {
      threw = true;
    }
    assert(threw, `planLatestPoints must throw on day ${JSON.stringify(day)}`);
  }
}
