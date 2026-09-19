import type { CalcHours, CalcWindowFn } from "./ast";
import { MAX_ROLLING_WINDOW_DAYS } from "./limits";
import { parseWindowLiteral, windowKey } from "./window-ref";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `parseWindowLiteral` reads the SHAPE of a `window` token's text (ADR 0070
 * decision 5; `E4.1b` plan design decision 6): a rolling `<n>(m|h|d)` becomes
 * minutes, a calendar word becomes its period, a zero amount is `"malformed"`
 * and an amount over `MAX_ROLLING_WINDOW_DAYS` is `"too_long"`. The lexer has
 * already guaranteed the text is one of the two forms, so a foreign string is
 * `"malformed"` rather than a throw.
 */
export function runWindowLiteralTests(): void {
  const table: [string, ReturnType<typeof parseWindowLiteral>][] = [
    ["15m", { kind: "rolling", minutes: 15 }],
    ["24h", { kind: "rolling", minutes: 1440 }],
    ["1440m", { kind: "rolling", minutes: 1440 }],
    ["7d", { kind: "rolling", minutes: 10080 }],
    ["1m", { kind: "rolling", minutes: 1 }],
    ["366d", { kind: "rolling", minutes: 366 * 1440 }],
    ["367d", "too_long"],
    ["8785h", "too_long"],
    ["527041m", "too_long"],
    ["0h", "malformed"],
    ["0m", "malformed"],
    ["00d", "malformed"],
    ["today", { kind: "calendar", period: "today" }],
    ["this_week", { kind: "calendar", period: "this_week" }],
    ["this_month", { kind: "calendar", period: "this_month" }],
    ["this_year", { kind: "calendar", period: "this_year" }],
    ["24H", "malformed"],
    ["24", "malformed"],
    ["h", "malformed"],
    ["tomorrow", "malformed"],
    ["", "malformed"],
  ];
  for (const [text, expected] of table) {
    const actual = parseWindowLiteral(text);
    assert(
      JSON.stringify(actual) === JSON.stringify(expected),
      `parseWindowLiteral(${JSON.stringify(text)}) must be ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
  assert(MAX_ROLLING_WINDOW_DAYS === 366, "the cap the table above is written against");
}

/**
 * `windowKey` is the ONE canonical key for a window read (the `crossRefKey`
 * pattern): the parser dedupes `windowReads` by it, the evaluator looks the
 * fifth map up by it, and the host fills that map by it. A rolling window is
 * normalised to minutes so `24h` and `1440m` over the same point are one
 * read; `position` is never part of the key.
 */
export function runWindowKeyTests(): void {
  const local: CalcWindowFn = {
    kind: "window",
    fn: "delta",
    ref: { kind: "ref", pointKey: "kwh", position: 6 },
    window: { kind: "calendar", period: "today" },
    position: 0,
  };
  assert(windowKey(local) === "delta({kwh}, today)", `got ${windowKey(local)}`);

  const qualified: CalcWindowFn = {
    kind: "window",
    fn: "avg",
    ref: { kind: "qref", assetCode: "TX_01", pointKey: "kw", position: 4 },
    window: { kind: "rolling", minutes: 1440 },
    position: 0,
  };
  assert(windowKey(qualified) === "avg({TX_01.kw}, 1440m)", `got ${windowKey(qualified)}`);

  const hours: CalcHours = { kind: "hours", window: { kind: "calendar", period: "this_week" }, position: 0 };
  assert(windowKey(hours) === "hours(this_week)", `got ${windowKey(hours)}`);

  const rollingHours: CalcHours = { kind: "hours", window: { kind: "rolling", minutes: 90 }, position: 3 };
  assert(windowKey(rollingHours) === "hours(90m)", `got ${windowKey(rollingHours)}`);

  // position is not part of the key
  const moved: CalcWindowFn = { ...local, position: 40, ref: { ...local.ref, position: 46 } as CalcWindowFn["ref"] };
  assert(windowKey(moved) === windowKey(local), "the same read at another offset is one key");

  // the point key is quoted by braces, so a key containing a comma or a
  // paren cannot forge a different read's key
  const odd: CalcWindowFn = {
    ...local,
    ref: { kind: "ref", pointKey: "a, today)", position: 6 },
  };
  assert(windowKey(odd) === "delta({a, today)}, today)", `braces quote the point key, got ${windowKey(odd)}`);
  assert(windowKey(odd) !== windowKey(local), "a forged key stays distinct");
}
