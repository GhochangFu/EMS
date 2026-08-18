import type { AlarmSeverityDto, PillTone } from "@bms/shared";

/**
 * The colour for one alarm's severity pill, resolved against the vocabulary
 * (ADR 0032).
 *
 * **This was an exhaustive `switch` over a `z.enum`, and that shape had to go.**
 * Migration `0029` already recorded why: `categoryStyle` was an exhaustive
 * switch over the category enum, so the moment that vocabulary opened, a newly
 * seeded category rendered unstyled — the `F4.43` empty-badge failure. `F4.46`
 * shipped the same shape here. Under an open severity vocabulary it would fail
 * the same way, so styling travels with the value instead: `tone` is a column
 * of `bms.alarm_severities`, and a level cannot be declared without one.
 *
 * **The unknown branch stays, and ADR 0032 does not weaken it.** The foreign
 * keys make an unrecognised code impossible *at rest*, but this page renders an
 * alarm payload against a separately-fetched vocabulary — so a retired code, or
 * a client holding a stale vocabulary while a new level is seeded, still
 * presents one. `F4.46`'s answer stands: neutral grey, never `info`.
 *
 * Grey is the answer that invents nothing. Promoting an uninterpretable value
 * to `critical` would manufacture urgency exactly as `info` manufactured calm —
 * the reasoning `severityFromRule` (`lib/rule-severity.ts`) already settled on
 * the authoring side.
 */
export function alarmSeverityTone(
  severity: string,
  vocabulary: readonly AlarmSeverityDto[],
): PillTone {
  return vocabulary.find((entry) => entry.code === severity)?.tone ?? "offline";
}

/**
 * The alarm counts behind the summary cards.
 *
 * The card names are the **mockup's** vocabulary — Critical / Major / Minor
 * (`ESKOM_SMOC.html`, `TRINETRA.html`, both AGENTS.md §5 references) — and the
 * stored values are the **product's**. Those two lists are not the same list,
 * and `F4.46` finding (3) is what happens when that goes unrecorded: the page
 * compared stored severities against `"major"`, a mockup word that appears in
 * no contract, no schema and no row.
 *
 * **Buckets resolve by `tone`, not by code**, which is what lets three fixed
 * cards survive an open vocabulary. `tone` is the closed half of ADR 0032 — a
 * presentation vocabulary owned by the frontend, bounded by
 * `alarm_severities_tone_check` — so it stays a fixed set however many severity
 * levels exist. Answering client ask `B9` by seeding `high` at rank 25 with
 * tone `warning` therefore needs no change here: it counts under Major,
 * correctly, on the day it is inserted.
 *
 * `unrecognised` is the other half of `F4.46` finding (2). `minor` used to be a
 * catch-all — *not critical and not warning* — so an unknown severity was
 * **counted as the least urgent bucket** as well as coloured as one. A code the
 * vocabulary does not contain now has its own counter, and the four always sum
 * to the number of rows: a value we cannot classify can no longer hide inside
 * one we can. A code the vocabulary *does* contain always lands in one of the
 * three cards, whatever its tone — it is classified, and only the unclassified
 * belong in the fourth.
 *
 * **How reachable is the unknown case? Through the product's own write path, it
 * is not** — worth stating plainly rather than leaving the card looking livelier
 * than it is. `AlarmThresholdService.normalizeSeverity`
 * (`alarm-threshold.service.ts:138`) is the only rule-driven writer of
 * `bms.alarms.severity` and collapses anything outside the three seeded values
 * — `null` included — to `"warning"` before the insert, and since ADR 0032
 * `alarms_severity_fk` closes the column behind it. This is a boundary guard
 * against vocabulary skew between two fetches, not a live path.
 */
export type AlarmSeveritySummary = {
  critical: number;
  major: number;
  minor: number;
  unrecognised: number;
};

/**
 * Counts one page of alarm severities into the four buckets above.
 *
 * Every input increments exactly one counter, so the four always sum to
 * `severities.length` — the property the summary row depends on, and the reason
 * `unrecognised` exists at all rather than the unknown case being dropped.
 * Asserted in `alarm-severity.spec.ts`, including over an input made only of
 * unknowns and over a vocabulary carrying a fourth level.
 */
export function summariseAlarmSeverities(
  severities: readonly string[],
  vocabulary: readonly AlarmSeverityDto[],
): AlarmSeveritySummary {
  const summary: AlarmSeveritySummary = {
    critical: 0,
    major: 0,
    minor: 0,
    unrecognised: 0,
  };

  for (const severity of severities) {
    const entry = vocabulary.find((candidate) => candidate.code === severity);
    if (!entry) {
      summary.unrecognised += 1;
    } else if (entry.tone === "critical") {
      summary.critical += 1;
    } else if (entry.tone === "warning") {
      summary.major += 1;
    } else {
      summary.minor += 1;
    }
  }

  return summary;
}
