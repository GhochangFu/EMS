import type { AlarmSeverityDto } from "@bms/shared";

import { alarmSeverityTone, summariseAlarmSeverities } from "./alarm-severity";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** What migration `0030` seeds. */
const SEEDED: AlarmSeverityDto[] = [
  { code: "info", label: "Info", tone: "info", rank: 10, active: true },
  { code: "warning", label: "Warning", tone: "warning", rank: 20, active: true },
  { code: "critical", label: "Critical", tone: "critical", rank: 30, active: true },
];

/**
 * The vocabulary after answering client ask `B9` with a fourth level. One
 * `INSERT`, at the rank the seeded spacing leaves free — see ADR 0032
 * decision 2.
 */
const WITH_HIGH: AlarmSeverityDto[] = [
  ...SEEDED,
  { code: "high", label: "High", tone: "warning", rank: 25, active: true },
];

/**
 * `F4.46` finding (2), the colour half, now resolved through the vocabulary
 * (ADR 0032).
 *
 * These assert the **behaviour** rather than the absence of the `"major"`
 * string (AGENTS.md §4.4): a test that greps for a removed literal passes
 * against a file that reintroduces the same defect under another spelling.
 * What matters is that a severity this page cannot resolve is not painted as
 * the calmest thing on it.
 */
export function runAlarmSeverityToneTests(): void {
  assert(alarmSeverityTone("critical", SEEDED) === "critical", "critical must keep its tone");
  assert(alarmSeverityTone("warning", SEEDED) === "warning", "warning must keep its tone");
  assert(alarmSeverityTone("info", SEEDED) === "info", "info must keep its tone");

  // The defect. `"info"` is the least-urgent tone on the page, and it was what
  // every unrecognised value got.
  for (const unknown of ["major", "high", "minor", "", "CRITICAL", "unknown"]) {
    assert(
      alarmSeverityTone(unknown, SEEDED) !== "info",
      `an unresolvable severity (${JSON.stringify(unknown)}) must not be coloured as the least urgent`,
    );
    assert(
      alarmSeverityTone(unknown, SEEDED) === "offline",
      `an unresolvable severity (${JSON.stringify(unknown)}) must take the neutral tone`,
    );
  }

  // Case matters: codes are lower-case, and a near-miss is still a miss.
  // Guessing that `"CRITICAL"` means `critical` is the same class of invention
  // as guessing that an unknown value means `info`.
  assert(
    alarmSeverityTone("CRITICAL", SEEDED) !== "critical",
    "a near-miss must not be guessed into a match",
  );

  // ADR 0032's whole purpose: a level added by an INSERT arrives styled, with
  // no code change. The pre-0032 exhaustive switch could not do this — it is
  // the `F4.43` unstyled-badge failure that shape always produces.
  assert(
    alarmSeverityTone("high", WITH_HIGH) === "warning",
    "a newly seeded level must take the tone its own row declares",
  );
  assert(
    alarmSeverityTone("high", SEEDED) === "offline",
    "the same code must stay neutral against a vocabulary that does not carry it",
  );
}

/**
 * `F4.46` findings (2) and (3), the counting half.
 *
 * The buckets carry the mockup's names (Critical / Major / Minor) and resolve
 * by `tone`, which is the closed half of ADR 0032 — so three fixed cards
 * survive an open vocabulary.
 */
export function runAlarmSeveritySummaryTests(): void {
  const summary = summariseAlarmSeverities(
    ["critical", "critical", "warning", "info", "major", "high"],
    SEEDED,
  );

  assert(summary.critical === 2, "critical rows count as Critical");
  assert(summary.major === 1, "a stored `warning` is the mockup's Major");
  assert(summary.minor === 1, "a stored `info` is the mockup's Minor, and only a resolvable calm code");
  assert(summary.unrecognised === 2, "`major` and `high` are in no vocabulary row and counted as such");

  // The defect: `major` and `high` used to land in `minor`.
  assert(
    summariseAlarmSeverities(["major"], SEEDED).minor === 0,
    "an unresolvable severity must not be counted as the least urgent bucket",
  );

  // Seed the fourth level and the same input reclassifies, with no code change.
  const afterB9 = summariseAlarmSeverities(["high", "high", "warning"], WITH_HIGH);
  assert(afterB9.major === 3, "`high` counts under Major once its row declares tone `warning`");
  assert(afterB9.unrecognised === 0, "a seeded level is no longer unrecognised");

  // Nothing may vanish. The four buckets are the only exits, so their sum is
  // the row count for any input — including one made only of unknowns.
  for (const rows of [
    ["critical", "warning", "info"],
    ["major", "high", "", "info"],
    [],
    ["nonsense"],
  ]) {
    for (const vocabulary of [SEEDED, WITH_HIGH, []]) {
      const counted = summariseAlarmSeverities(rows, vocabulary);
      assert(
        counted.critical + counted.major + counted.minor + counted.unrecognised === rows.length,
        `every row must land in exactly one bucket (${JSON.stringify(rows)})`,
      );
    }
  }

  // An empty vocabulary is the stale-client case, and it must degrade to "I
  // cannot classify these" rather than to "these are calm".
  const stale = summariseAlarmSeverities(["critical", "warning", "info"], []);
  assert(stale.unrecognised === 3, "with no vocabulary every code is unresolvable");
  assert(stale.minor === 0, "a stale vocabulary must not report live alarms as the calmest bucket");
}
