import { automationRuleSeveritySchema } from "@bms/shared/contracts";

/**
 * Tones the alarms page may give a severity pill. A subset of `StatusPill`'s
 * palette (`components/status-pill.tsx:3`) plus `offline`, which is the neutral
 * grey and is what an unrecognised severity gets — see `alarmSeverityTone`.
 */
export type AlarmSeverityTone = "critical" | "warning" | "info" | "offline";

/**
 * The colour for one alarm's severity pill.
 *
 * `alarmListItemSchema.severity` is `z.string()`
 * (`packages/shared/src/contracts/operations.ts:82`) and `bms.alarms.severity`
 * is `varchar(32)` with no constraint (`bms-schema.ts:429`), so an unrecognised
 * value is reachable at this layer even though nothing writes one today.
 *
 * `F4.46` finding (2): the version this replaces returned `"info"` for anything
 * it did not recognise, so an unknown severity was **coloured as the least
 * urgent thing on the page** while its label — rendered raw at
 * `alarms-page.tsx` — stayed correct. Read one way the row said "unknown";
 * read the way an operator actually scans a board, by colour, it said "calm".
 *
 * An unrecognised value now takes the neutral grey instead. Grey is the answer
 * that invents nothing: promoting it to `critical` would manufacture urgency
 * from a value we cannot interpret, exactly as `"info"` manufactured calm.
 * `severityFromRule` (`lib/rule-severity.ts`) already settled this question the
 * same way on the authoring side — "the only answer that does not invent data".
 *
 * The vocabulary is **derived, not restated** (AGENTS.md §4.8): it comes from
 * `automationRuleSeveritySchema`, the same enum the rule builder writes through.
 * The `switch` is exhaustive on purpose. Adding a value to that enum — which is
 * what answering the client's **B9** with a `high` level would do — becomes a
 * TypeScript error here rather than a silently mis-coloured pill.
 */
export function alarmSeverityTone(severity: string): AlarmSeverityTone {
  const parsed = automationRuleSeveritySchema.safeParse(severity);
  if (!parsed.success) {
    return "offline";
  }
  switch (parsed.data) {
    case "critical":
      return "critical";
    case "warning":
      return "warning";
    case "info":
      return "info";
  }
}

/**
 * The alarm counts behind the summary cards.
 *
 * The card names are the **mockup's** vocabulary — Critical / Major / Minor
 * (`ESKOM_SMOC.html`, `TRINETRA.html`, both AGENTS.md §5 references) — and the
 * stored values are the **product's** — `critical` / `warning` / `info`. Those
 * two lists are not the same list, and `F4.46` finding (3) is what happens when
 * that goes unrecorded: the page compared stored severities against `"major"`,
 * a mockup word that appears in no contract, no schema and no row. Measured
 * 2026-08-18 on the pilot database, `bms.alarms` holds `warning` 20 /
 * `critical` 19 / `info` 1 — no `major`, so every one of those comparisons was
 * dead. The label stays; the comparisons are gone.
 *
 * `unrecognised` is the other half of finding (2). `minor` used to be a
 * catch-all — *not critical and not warning* — so an unknown severity was
 * **counted as the least urgent bucket** as well as coloured as one. Each
 * bucket is now an equality test and unknowns have their own counter, so the
 * four always sum to the number of rows: a value we cannot classify can no
 * longer hide inside one we can.
 */
export type AlarmSeveritySummary = {
  critical: number;
  major: number;
  minor: number;
  unrecognised: number;
};

export function summariseAlarmSeverities(
  severities: readonly string[],
): AlarmSeveritySummary {
  const summary: AlarmSeveritySummary = {
    critical: 0,
    major: 0,
    minor: 0,
    unrecognised: 0,
  };

  for (const severity of severities) {
    const parsed = automationRuleSeveritySchema.safeParse(severity);
    if (!parsed.success) {
      summary.unrecognised += 1;
      continue;
    }
    switch (parsed.data) {
      case "critical":
        summary.critical += 1;
        break;
      case "warning":
        summary.major += 1;
        break;
      case "info":
        summary.minor += 1;
        break;
    }
  }

  return summary;
}
