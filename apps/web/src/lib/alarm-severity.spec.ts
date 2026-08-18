import { alarmSeverityTone, summariseAlarmSeverities } from "./alarm-severity";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `F4.46` finding (2), the colour half.
 *
 * These assert the **behaviour** rather than the absence of the `"major"`
 * string (AGENTS.md §4.4): a test that greps for a removed literal passes
 * against a file that reintroduces the same defect under another spelling.
 * What matters is that a severity this page cannot interpret is not painted as
 * the calmest thing on it.
 */
export function runAlarmSeverityToneTests(): void {
  assert(alarmSeverityTone("critical") === "critical", "critical must keep its tone");
  assert(alarmSeverityTone("warning") === "warning", "warning must keep its tone");
  assert(alarmSeverityTone("info") === "info", "info must keep its tone");

  // The defect. `"info"` is the least-urgent tone on the page, and it was what
  // every unrecognised value got.
  for (const unknown of ["major", "high", "minor", "", "CRITICAL", "unknown"]) {
    assert(
      alarmSeverityTone(unknown) !== "info",
      `an unrecognised severity (${JSON.stringify(unknown)}) must not be coloured as the least urgent`,
    );
    assert(
      alarmSeverityTone(unknown) === "offline",
      `an unrecognised severity (${JSON.stringify(unknown)}) must take the neutral tone`,
    );
  }

  // Case matters: the stored vocabulary is lower-case, and a near-miss is still
  // a miss. Guessing that `"CRITICAL"` means `critical` is the same class of
  // invention as guessing that an unknown value means `info`.
  assert(alarmSeverityTone("CRITICAL") !== "critical", "a near-miss must not be guessed into a match");
}

/**
 * `F4.46` findings (2) and (3), the counting half.
 *
 * The buckets carry the mockup's names (Critical / Major / Minor) over the
 * product's values (`critical` / `warning` / `info`). `minor` used to be a
 * catch-all, so an unrecognised severity was counted as the least urgent
 * bucket as well as coloured as one.
 */
export function runAlarmSeveritySummaryTests(): void {
  const summary = summariseAlarmSeverities([
    "critical",
    "critical",
    "warning",
    "info",
    "major",
    "high",
  ]);

  assert(summary.critical === 2, "critical rows count as Critical");
  assert(summary.major === 1, "a stored `warning` is the mockup's Major");
  assert(summary.minor === 1, "a stored `info` is the mockup's Minor, and only a stored `info`");
  assert(summary.unrecognised === 2, "`major` and `high` are recognised by nothing and counted as such");

  // The defect: `major` and `high` used to land in `minor`.
  assert(
    summariseAlarmSeverities(["major"]).minor === 0,
    "an unrecognised severity must not be counted as the least urgent bucket",
  );

  // Nothing may vanish. The four buckets are the only exits, so their sum is
  // the row count for any input — including one made only of unknowns.
  for (const rows of [
    ["critical", "warning", "info"],
    ["major", "high", "", "info"],
    [],
    ["nonsense"],
  ]) {
    const counted = summariseAlarmSeverities(rows);
    assert(
      counted.critical + counted.major + counted.minor + counted.unrecognised === rows.length,
      `every row must land in exactly one bucket (${JSON.stringify(rows)})`,
    );
  }
}
