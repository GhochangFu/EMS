import { alarmRootCauseSuggestionsResponseSchema, type RootCauseCandidate } from "@bms/shared";
import { expect } from "vitest";

import type { AssetAnomalyDbRow } from "../ml/ml-anomalies.pure";

import {
  anomalyContextOf,
  anomalyWindowBefore,
  buildRootCauseSuggestions,
  cutMessage,
  rankRootCauseCandidates,
  type RootCauseAlarmRow,
  type RootCauseEvidence,
  type RootCauseWindowRow,
} from "./alarm-root-cause.pure";

/**
 * `E2.3` / ADR 0136 — the pure ranking step and the anomaly context step (plan
 * `docs/plans/e2.3-root-cause-suggestions.md` §4 and T1.2). No database, no
 * clock. Assertions live here; `alarm-root-cause.pure.test.ts` is the vitest
 * entry point (ADR 0014). Fixtures are synthetic.
 */
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T = Date.parse("2026-11-16T10:30:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();

const ORG = "00000000-0000-4000-8000-00000000000a";
const OTHER_ORG = "00000000-0000-4000-8000-00000000000b";
const SUBJECT = "a0000000-0000-4000-8000-000000000000";
const ASSET = "a1000000-0000-4000-8000-000000000001";
const ASSET_SAME_RTU = "a2000000-0000-4000-8000-000000000002";
const ASSET_SAME_LOCATION = "a3000000-0000-4000-8000-000000000003";
const ASSET_ELSEWHERE = "a4000000-0000-4000-8000-000000000004";
const RTU = "b1000000-0000-4000-8000-000000000001";
const OTHER_RTU = "b2000000-0000-4000-8000-000000000002";
const LOCATION = "c1000000-0000-4000-8000-000000000001";
const PARENT_LOCATION = "c0000000-0000-4000-8000-000000000000";
const OTHER_LOCATION = "c2000000-0000-4000-8000-000000000002";
const RULE = "d1000000-0000-4000-8000-000000000001";
const OTHER_RULE = "d2000000-0000-4000-8000-000000000002";

let seq = 0;
const nextId = (prefix: string): string => `${prefix}${String(++seq).padStart(7, "0")}-0000-4000-8000-000000000000`;

const subject = {
  alarmId: SUBJECT,
  organizationId: ORG,
  raisedAtMs: T,
  assetId: ASSET,
  ruleId: RULE as string | null,
  rtuId: RTU as string | null,
  rtuName: "Demo RTU 1" as string | null,
  locationId: LOCATION,
  locationAncestorIds: [LOCATION, PARENT_LOCATION],
};

const empty: RootCauseEvidence = {
  subject,
  windows: [],
  rtuCommsAlarms: [],
  relatedAlarms: [],
  pastRootCauses: [],
  classCause: null,
};

const evidenceOf = (overrides: Partial<RootCauseEvidence>): RootCauseEvidence => ({ ...empty, ...overrides });

const windowRow = (startsMs: number, endMs: number, targets: Partial<RootCauseWindowRow> = {}): RootCauseWindowRow => ({
  id: nextId("e"),
  organizationId: ORG,
  startsMs,
  endMs,
  assetIds: [ASSET],
  locationIds: [],
  ruleIds: [],
  ...targets,
});

const alarmRow = (raisedMs: number, overrides: Partial<RootCauseAlarmRow> = {}): RootCauseAlarmRow => ({
  id: nextId("f"),
  source: "rule",
  assetId: ASSET_SAME_RTU,
  ruleId: OTHER_RULE,
  rtuId: null,
  message: "Demo pump trip",
  raisedMs,
  clearedMs: null,
  assetCode: "DEMO-M2",
  assetRtuId: RTU,
  assetLocationId: LOCATION,
  assetRtuName: "Demo RTU 1",
  assetLocationName: "Demo site",
  ...overrides,
});

const commsRow = (raisedMs: number, overrides: Partial<RootCauseAlarmRow> = {}): RootCauseAlarmRow =>
  alarmRow(raisedMs, {
    source: "rtu_comms",
    assetId: null,
    ruleId: null,
    rtuId: RTU,
    message: "Communication lost",
    assetCode: null,
    assetRtuId: null,
    assetLocationId: null,
    assetRtuName: null,
    assetLocationName: null,
    ...overrides,
  });

const pastRow = (raisedMs: number, rootCause: string) => ({ alarmId: nextId("9"), raisedMs, rootCause });

const philosophy = { cause: "Bearing wear on the demo pump", templateName: "Demo pump", templateVersion: 3 };

const rulesOf = (candidates: readonly RootCauseCandidate[]): string[] => candidates.map((c) => c.rule);
const one = (evidence: RootCauseEvidence): RootCauseCandidate => {
  const candidates = rankRootCauseCandidates(evidence);
  expect(candidates).toHaveLength(1);
  return candidates[0]!;
};

export function noEvidenceGivesNoCandidate(): void {
  expect(rankRootCauseCandidates(empty)).toEqual([]);
  expect(buildRootCauseSuggestions(empty, [], new Date(T)).candidates).toEqual([]);
}

export function r1ACoveringWindowIsStrong(): void {
  const start = T - 2 * HOUR;
  const end = T - 20 * MIN;
  const window = windowRow(start, end);
  const candidate = one(evidenceOf({ windows: [window] }));
  expect(candidate).toMatchObject({
    rule: "maintenance",
    strength: "strong",
    title: "Maintenance on this asset",
    quote: null,
    occurrences: null,
  });
  expect(candidate.evidence).toEqual([
    {
      kind: "maintenance_window",
      at: iso(start),
      endedAt: iso(end),
      alarmId: null,
      assetId: null,
      assetCode: null,
      assetRtuName: null,
      assetLocationName: null,
      label: null,
    },
  ]);
  // A target on an ancestor location covers the asset.
  const onParent = windowRow(start, T + HOUR, { assetIds: [], locationIds: [PARENT_LOCATION] });
  expect(one(evidenceOf({ windows: [onParent] })).rule).toBe("maintenance");
}

export function r1CountsAssetAndLocationTargetsOnly(): void {
  // R-d: a window that targets only the alarm's rule did not cover the asset.
  const ruleOnly = windowRow(T - HOUR, T + HOUR, { assetIds: [], ruleIds: [RULE] });
  const elsewhere = windowRow(T - HOUR, T + HOUR, { assetIds: [ASSET_ELSEWHERE], locationIds: [OTHER_LOCATION] });
  const otherOrg = windowRow(T - HOUR, T + HOUR, { organizationId: OTHER_ORG });
  expect(rankRootCauseCandidates(evidenceOf({ windows: [ruleOnly, elsewhere, otherOrg] }))).toEqual([]);
}

export function r1TimeBounds(): void {
  const in60 = windowRow(T - 3 * HOUR, T - 60 * MIN + 1);
  const at60 = windowRow(T - 3 * HOUR, T - 60 * MIN);
  const startsAtT = windowRow(T, T + HOUR);
  const startsAfter = windowRow(T + 1, T + HOUR);
  const picked = one(evidenceOf({ windows: [in60, at60, startsAtT, startsAfter] }));
  expect(picked.evidence.map((e) => e.at)).toEqual([iso(T), iso(T - 3 * HOUR)]);
}

export function r1SixWindowsGiveFiveNewestFirst(): void {
  const windows = [5, 1, 3, 6, 2, 4].map((n) => windowRow(T - n * 10 * MIN, T + HOUR));
  const candidate = one(evidenceOf({ windows }));
  expect(candidate.evidence.map((e) => e.at)).toEqual([1, 2, 3, 4, 5].map((n) => iso(T - n * 10 * MIN)));
}

export function r2ACommsAlarmOnTheAssetsRtuIsStrong(): void {
  const row = commsRow(T - 40 * MIN, { clearedMs: T - 35 * MIN });
  const candidate = one(evidenceOf({ rtuCommsAlarms: [row] }));
  expect(candidate).toMatchObject({
    rule: "rtu_comms",
    strength: "strong",
    title: "Communication or power loss at RTU Demo RTU 1",
  });
  expect(candidate.evidence).toEqual([
    {
      kind: "rtu_comms_alarm",
      at: iso(T - 40 * MIN),
      endedAt: iso(T - 35 * MIN),
      alarmId: row.id,
      assetId: null,
      assetCode: null,
      assetRtuName: null,
      assetLocationName: null,
      label: "Communication lost",
    },
  ]);
}

export function r2TimeBoundsAndRtu(): void {
  const rows = [
    commsRow(T - 60 * MIN),
    commsRow(T - 60 * MIN - 1),
    commsRow(T),
    commsRow(T + 1),
    commsRow(T - MIN, { rtuId: OTHER_RTU }),
  ];
  const candidate = one(evidenceOf({ rtuCommsAlarms: rows }));
  expect(candidate.evidence.map((e) => e.at)).toEqual([iso(T), iso(T - 60 * MIN)]);
}

export function r2NeverWithoutAnRtu(): void {
  const noRtu = { ...subject, rtuId: null, rtuName: null };
  const rows = [commsRow(T - MIN, { rtuId: null }), commsRow(T - MIN)];
  expect(rankRootCauseCandidates(evidenceOf({ subject: noRtu, rtuCommsAlarms: rows }))).toEqual([]);
}

export function r3SameAssetOrRtuIsModerate(): void {
  const sameAsset = alarmRow(T - 10 * MIN, { assetId: ASSET, assetRtuId: RTU, ruleId: OTHER_RULE });
  expect(one(evidenceOf({ relatedAlarms: [sameAsset] }))).toMatchObject({ rule: "linked_alarm", strength: "moderate" });
  const sameRtu = alarmRow(T - 10 * MIN, { assetLocationId: OTHER_LOCATION });
  const candidate = one(evidenceOf({ relatedAlarms: [sameRtu] }));
  expect(candidate).toMatchObject({ rule: "linked_alarm", strength: "moderate", title: 'Linked to "Demo pump trip"' });
  expect(candidate.evidence).toEqual([
    {
      kind: "alarm",
      at: iso(T - 10 * MIN),
      endedAt: null,
      alarmId: sameRtu.id,
      assetId: ASSET_SAME_RTU,
      assetCode: "DEMO-M2",
      assetRtuName: "Demo RTU 1",
      assetLocationName: "Demo site",
      label: "Demo pump trip",
    },
  ]);
}

export function r3bLocationOnlyIsWeak(): void {
  const row = alarmRow(T - 10 * MIN, { assetId: ASSET_SAME_LOCATION, assetRtuId: OTHER_RTU });
  expect(one(evidenceOf({ relatedAlarms: [row] }))).toMatchObject({ rule: "linked_alarm_location", strength: "weak" });
}

export function r3BothRelationsAreR3Only(): void {
  // Same RTU and same location: R3, never also R3b.
  const row = alarmRow(T - 10 * MIN);
  expect(rulesOf(rankRootCauseCandidates(evidenceOf({ relatedAlarms: [row] })))).toEqual(["linked_alarm"]);
}

export function r3NeverTheReRaiseNorACommsRowNorItself(): void {
  const reRaise = alarmRow(T - 10 * MIN, { assetId: ASSET, ruleId: RULE, clearedMs: T - 5 * MIN });
  const comms = commsRow(T - 10 * MIN, { assetId: ASSET, assetRtuId: RTU, assetLocationId: LOCATION });
  const itself = alarmRow(T, { id: SUBJECT, assetId: ASSET, ruleId: OTHER_RULE });
  const elsewhere = alarmRow(T - MIN, { assetId: ASSET_ELSEWHERE, assetRtuId: OTHER_RTU, assetLocationId: OTHER_LOCATION });
  expect(rankRootCauseCandidates(evidenceOf({ relatedAlarms: [reRaise, comms, itself, elsewhere] }))).toEqual([]);
}

export function r3TimeBounds(): void {
  const rows = [alarmRow(T - 30 * MIN), alarmRow(T - 30 * MIN - 1), alarmRow(T), alarmRow(T + 1)];
  const candidate = one(evidenceOf({ relatedAlarms: rows }));
  // R-f: the same instant is "before".
  expect(candidate.evidence.map((e) => e.at)).toEqual([iso(T), iso(T - 30 * MIN)]);
}

export function r3TitleNamesTheNewestAndCutsAt200(): void {
  const older = alarmRow(T - 20 * MIN, { message: "Older demo alarm" });
  const newest = alarmRow(T - 5 * MIN, { message: "x".repeat(500) });
  const candidate = one(evidenceOf({ relatedAlarms: [older, newest] }));
  const cut = `${"x".repeat(200)}…`;
  expect(candidate.title).toBe(`Linked to "${cut}"`);
  expect(candidate.evidence.map((e) => e.label)).toEqual([cut, "Older demo alarm"]);
  expect(cutMessage("y".repeat(200))).toBe("y".repeat(200));
  // A surrogate pair is never split.
  expect(cutMessage(`${"z".repeat(199)}\uD83D\uDE00tail`)).toBe(`${"z".repeat(199)}…`);
}

export function r3AnAssetWithoutAnRtuMatchesNoRtulessAsset(): void {
  const noRtu = { ...subject, rtuId: null, rtuName: null };
  const row = alarmRow(T - MIN, { assetId: ASSET_ELSEWHERE, assetRtuId: null, assetLocationId: OTHER_LOCATION });
  expect(rankRootCauseCandidates(evidenceOf({ subject: noRtu, relatedAlarms: [row] }))).toEqual([]);
}

export function r4GroupsByTrimAndCaseFold(): void {
  const candidates = rankRootCauseCandidates(
    evidenceOf({ pastRootCauses: [pastRow(T - 10 * DAY, "bearing DRY"), pastRow(T - 2 * DAY, " Bearing dry ")] }),
  );
  expect(candidates).toHaveLength(1);
  expect(candidates[0]).toMatchObject({
    rule: "recorded_before",
    strength: "moderate",
    title: "Recorded before",
    quote: "Bearing dry",
    occurrences: 2,
  });
  expect(candidates[0]!.evidence.map((e) => [e.kind, e.at])).toEqual([
    ["enrichment", iso(T - 2 * DAY)],
    ["enrichment", iso(T - 10 * DAY)],
  ]);
}

export function r4OneRowIsWeakAndTheQuoteIsNeverCut(): void {
  const text = "q".repeat(1500);
  expect(one(evidenceOf({ pastRootCauses: [pastRow(T - DAY, text)] }))).toMatchObject({
    strength: "weak",
    quote: text,
    occurrences: 1,
  });
}

export function r4TwoGroupsInSectionFourOrder(): void {
  const rows = [
    pastRow(T - DAY, "Valve stuck"),
    pastRow(T - 3 * DAY, "Belt slip"),
    pastRow(T - 4 * DAY, "belt slip"),
    pastRow(T - 5 * DAY, "   "),
  ];
  const candidates = rankRootCauseCandidates(evidenceOf({ pastRootCauses: rows }));
  expect(candidates.map((c) => [c.strength, c.quote, c.occurrences])).toEqual([
    ["moderate", "Belt slip", 2],
    ["weak", "Valve stuck", 1],
  ]);
  // Same strength and the same newest instant: more occurrences, then quote ascending.
  const tied = [
    pastRow(T - DAY, "Zeta cause"),
    pastRow(T - DAY, "Alpha cause"),
    pastRow(T - DAY, "Mid cause"),
    pastRow(T - 2 * DAY, "mid cause"),
    pastRow(T - DAY, "Big cause"),
    pastRow(T - 3 * DAY, "big cause"),
    pastRow(T - 4 * DAY, "BIG CAUSE"),
  ];
  expect(rankRootCauseCandidates(evidenceOf({ pastRootCauses: tied })).map((c) => c.quote)).toEqual([
    "Big cause",
    "Mid cause",
    "Alpha cause",
  ]);
}

export function r4TimeBoundsAndRule(): void {
  const rows = [
    pastRow(T - 180 * DAY, "In at 180 days"),
    pastRow(T - 180 * DAY - 1, "Out past 180 days"),
    pastRow(T, "Out at T"),
    { ...pastRow(T - DAY, "Out: the subject itself"), alarmId: SUBJECT },
  ];
  expect(rankRootCauseCandidates(evidenceOf({ pastRootCauses: rows })).map((c) => c.quote)).toEqual([
    "In at 180 days",
  ]);
  const noRule = { ...subject, ruleId: null };
  expect(rankRootCauseCandidates(evidenceOf({ subject: noRule, pastRootCauses: rows }))).toEqual([]);
}

export function r5IsWeakUndatedAndLastAmongTheWeak(): void {
  const r3b = alarmRow(T - 10 * MIN, { assetId: ASSET_SAME_LOCATION, assetRtuId: OTHER_RTU });
  const candidates = rankRootCauseCandidates(
    evidenceOf({ classCause: philosophy, relatedAlarms: [r3b], pastRootCauses: [pastRow(T - 170 * DAY, "Old")] }),
  );
  expect(rulesOf(candidates)).toEqual(["linked_alarm_location", "recorded_before", "class_cause"]);
  expect(candidates[2]).toEqual({
    rule: "class_cause",
    strength: "weak",
    title: "Class cause",
    quote: "Bearing wear on the demo pump",
    occurrences: null,
    evidence: [
      {
        kind: "class_philosophy",
        at: null,
        endedAt: null,
        alarmId: null,
        assetId: null,
        assetCode: null,
        assetRtuName: null,
        assetLocationName: null,
        label: "Demo pump v3",
      },
    ],
  });
}

export function r5NoneWithoutACause(): void {
  expect(rankRootCauseCandidates(evidenceOf({ classCause: null }))).toEqual([]);
  expect(rankRootCauseCandidates(evidenceOf({ classCause: { ...philosophy, cause: null } }))).toEqual([]);
  expect(rankRootCauseCandidates(evidenceOf({ classCause: { ...philosophy, cause: "  " } }))).toEqual([]);
}

export function orderIsStrengthThenRecencyThenTable(): void {
  // Weak (R3b, newest) after moderate (R3) after strong (R2, oldest).
  const evidence = evidenceOf({
    rtuCommsAlarms: [commsRow(T - 50 * MIN)],
    relatedAlarms: [
      alarmRow(T - 20 * MIN),
      alarmRow(T, { assetId: ASSET_SAME_LOCATION, assetRtuId: OTHER_RTU }),
    ],
  });
  expect(rulesOf(rankRootCauseCandidates(evidence))).toEqual(["rtu_comms", "linked_alarm", "linked_alarm_location"]);
  // Inside a strength the newer evidence first: R2 at T − 5 min before R1 ended at T − 30 min.
  const newer = evidenceOf({ windows: [windowRow(T - HOUR, T - 30 * MIN)], rtuCommsAlarms: [commsRow(T - 5 * MIN)] });
  expect(rulesOf(rankRootCauseCandidates(newer))).toEqual(["rtu_comms", "maintenance"]);
  // A full tie falls back to the table's order: R1 recency min(end, T) = T, R2 raised at T.
  const tie = evidenceOf({ rtuCommsAlarms: [commsRow(T)], windows: [windowRow(T - HOUR, T + HOUR)] });
  expect(rulesOf(rankRootCauseCandidates(tie))).toEqual(["maintenance", "rtu_comms"]);
  const moderateTie = evidenceOf({
    pastRootCauses: [pastRow(T - 5 * MIN, "Seal leak"), pastRow(T - DAY, "seal leak")],
    relatedAlarms: [alarmRow(T - 5 * MIN)],
  });
  expect(rulesOf(rankRootCauseCandidates(moderateTie))).toEqual(["linked_alarm", "recorded_before"]);
}

export function theCapIsThree(): void {
  const evidence = evidenceOf({
    windows: [windowRow(T - HOUR, T + HOUR)],
    rtuCommsAlarms: [commsRow(T - 5 * MIN)],
    relatedAlarms: [alarmRow(T - 5 * MIN), alarmRow(T - 5 * MIN, { assetId: ASSET_SAME_LOCATION, assetRtuId: null })],
    pastRootCauses: [pastRow(T - DAY, "Belt slip")],
    classCause: philosophy,
  });
  const candidates = rankRootCauseCandidates(evidence);
  expect(rulesOf(candidates)).toEqual(["maintenance", "rtu_comms", "linked_alarm"]);
}

const anomaly = (bucketMs: number, detector: string, score: number, points: string[] = ["kw"]): AssetAnomalyDbRow => ({
  bucket_ms: bucketMs,
  detector,
  score,
  contributing_points: points,
});

const ALARM_HOUR = Date.parse("2026-11-16T10:00:00.000Z");

export function anomaliesNeverChangeACandidate(): void {
  const allSix = [1, 2, 3, 4, 5, 6].flatMap((n) => [
    anomaly(ALARM_HOUR - n * HOUR, "baseline_mad", 1),
    anomaly(ALARM_HOUR - n * HOUR, "isolation_forest", 1),
  ]);
  const anomalyInputs: AssetAnomalyDbRow[][] = [
    [],
    [anomaly(ALARM_HOUR - HOUR, "baseline_mad", 0.99)],
    [anomaly(ALARM_HOUR - 2 * HOUR, "isolation_forest", 1)],
    [anomaly(ALARM_HOUR - HOUR, "baseline_mad", 1), anomaly(ALARM_HOUR - HOUR, "isolation_forest", 1)],
    allSix,
    [anomaly(ALARM_HOUR - HOUR, "seasonal_esd", 1)],
  ];
  const strong = evidenceOf({ windows: [windowRow(T - HOUR, T + HOUR)], rtuCommsAlarms: [commsRow(T - MIN)] });
  const weak = evidenceOf({ classCause: philosophy, pastRootCauses: [pastRow(T - DAY, "Belt slip")] });
  const now = new Date(T + 5 * MIN);
  for (const evidence of [strong, weak, empty]) {
    const baseline = rankRootCauseCandidates(evidence);
    for (const rows of anomalyInputs) {
      const answer = buildRootCauseSuggestions(evidence, rows, now);
      expect(answer.candidates).toEqual(baseline);
      expect(alarmRootCauseSuggestionsResponseSchema.safeParse(answer).success).toBe(true);
    }
  }
  // R-h: the ranking's input type has no anomaly member.
  // @ts-expect-error `anomalies` is not a key of RootCauseEvidence
  rankRootCauseCandidates({ ...empty, anomalies: allSix });
}

export function contextKeepsScoresAtOrAboveTheLine(): void {
  const window = anomalyWindowBefore(T);
  expect(anomalyContextOf([anomaly(ALARM_HOUR - HOUR, "baseline_mad", 0.989999)], window)).toEqual([]);
  expect(anomalyContextOf([anomaly(ALARM_HOUR - HOUR, "baseline_mad", 0.99)], window)).toEqual([
    {
      kind: "anomaly",
      from: "2026-11-16T04:00:00.000Z",
      to: "2026-11-16T10:00:00.000Z",
      unusualHours: 1,
      detectors: ["baseline_mad"],
      contributingPoints: ["kw"],
    },
  ]);
  expect(anomalyContextOf([], window)).toEqual([]);
}

export function contextCountsHoursAndSortsDetectorsAndPoints(): void {
  const window = anomalyWindowBefore(T);
  const rows = [
    anomaly(ALARM_HOUR - HOUR, "isolation_forest", 1, ["pf", "kw"]),
    anomaly(ALARM_HOUR - HOUR, "baseline_mad", 0.995, ["kw", "v_l1"]),
    anomaly(ALARM_HOUR - 3 * HOUR, "baseline_mad", 0.999, ["thd", "a_l1", "freq"]),
    anomaly(ALARM_HOUR - 4 * HOUR, "baseline_mad", 0.5, ["ignored"]),
    // Outside the window: the alarm's own hour and the seventh hour back.
    anomaly(ALARM_HOUR, "baseline_mad", 1, ["own_hour"]),
    anomaly(ALARM_HOUR - 7 * HOUR, "baseline_mad", 1, ["too_old"]),
  ];
  expect(anomalyContextOf(rows, window)).toEqual([
    {
      kind: "anomaly",
      from: "2026-11-16T04:00:00.000Z",
      to: "2026-11-16T10:00:00.000Z",
      unusualHours: 2,
      detectors: ["baseline_mad", "isolation_forest"],
      contributingPoints: ["a_l1", "freq", "kw", "pf", "thd"],
    },
  ]);
  // Through the whole answer too.
  expect(buildRootCauseSuggestions(empty, rows, new Date(T)).context).toHaveLength(1);
}

export function theAnomalyWindowIsTheSixWholeHoursBefore(): void {
  const at = (hhmmss: string): number => Date.parse(`2026-11-16T${hhmmss}.000Z`);
  expect(anomalyWindowBefore(at("10:55:00"))).toEqual({ fromHourMs: at("04:00:00"), endMs: at("10:00:00") });
  expect(anomalyWindowBefore(at("10:00:00"))).toEqual({ fromHourMs: at("04:00:00"), endMs: at("10:00:00") });
}

export function theAnswerParsesAndStampsNow(): void {
  const evidence = evidenceOf({
    windows: [windowRow(T - HOUR, T + HOUR)],
    relatedAlarms: [alarmRow(T - 5 * MIN, { message: "m".repeat(500) })],
    classCause: philosophy,
  });
  const now = new Date(T + 5 * MIN);
  const answer = buildRootCauseSuggestions(evidence, [], now);
  expect(answer.computedAt).toBe(now.toISOString());
  expect(answer.context).toEqual([]);
  expect(alarmRootCauseSuggestionsResponseSchema.parse(answer)).toEqual(answer);
}
