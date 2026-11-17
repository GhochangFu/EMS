import { expect } from "vitest";

import {
  ROOT_CAUSE_ANOMALY_LOOKBACK_HOURS,
  ROOT_CAUSE_EVIDENCE_KINDS,
  ROOT_CAUSE_MAX_CANDIDATES,
  ROOT_CAUSE_RULES,
  ROOT_CAUSE_STRENGTHS,
  alarmRootCauseSuggestionsResponseSchema,
  rootCauseCandidateSchema,
  rootCauseContextSchema,
  rootCauseEvidenceSchema,
} from "./alarm-root-cause";

/**
 * `E2.3` / ADR 0136 — the root-cause suggestions contract (plan
 * `docs/plans/e2.3-root-cause-suggestions.md` §4 and T1.1). Assertions live
 * here; `alarm-root-cause.test.ts` is the vitest entry point (ADR 0014).
 * Fixtures are synthetic.
 */
const ALARM = "33333333-3333-4333-8333-333333333333";
const ASSET = "11111111-1111-4111-8111-111111111111";
const AT = "2026-11-16T09:40:00.000Z";

const alarmEvidence = {
  kind: "alarm",
  at: AT,
  endedAt: null,
  alarmId: ALARM,
  assetId: ASSET,
  assetCode: "DEMO-M2",
  assetRtuName: "Demo RTU 1",
  assetLocationName: "Demo site",
  label: "Demo pump trip",
};

const candidate = {
  rule: "linked_alarm",
  strength: "moderate",
  title: 'Linked to "Demo pump trip"',
  quote: null,
  occurrences: null,
  evidence: [alarmEvidence],
};

const context = {
  kind: "anomaly",
  from: "2026-11-16T04:00:00.000Z",
  to: "2026-11-16T10:00:00.000Z",
  unusualHours: 2,
  detectors: ["baseline_mad", "isolation_forest"],
  contributingPoints: ["kw", "pf"],
};

const answer = {
  computedAt: "2026-11-16T10:05:00.000Z",
  candidates: [
    {
      rule: "maintenance",
      strength: "strong",
      title: "Maintenance on this asset",
      quote: null,
      occurrences: null,
      evidence: [
        { ...alarmEvidence, kind: "maintenance_window", endedAt: AT, alarmId: null, assetId: null, label: null },
      ],
    },
    candidate,
    {
      rule: "recorded_before",
      strength: "weak",
      title: "Recorded before",
      quote: "Bearing dry",
      occurrences: 1,
      evidence: [{ ...alarmEvidence, kind: "enrichment", assetId: null, assetCode: null, label: null }],
    },
  ],
  context: [context],
};

export function runConstantsTest(): void {
  expect(ROOT_CAUSE_MAX_CANDIDATES).toBe(3);
  expect(ROOT_CAUSE_ANOMALY_LOOKBACK_HOURS).toBe(6);
  expect([...ROOT_CAUSE_RULES]).toEqual([
    "maintenance",
    "rtu_comms",
    "linked_alarm",
    "linked_alarm_location",
    "recorded_before",
    "class_cause",
  ]);
  expect([...ROOT_CAUSE_STRENGTHS]).toEqual(["strong", "moderate", "weak"]);
  expect([...ROOT_CAUSE_EVIDENCE_KINDS]).toEqual([
    "maintenance_window",
    "rtu_comms_alarm",
    "alarm",
    "enrichment",
    "class_philosophy",
  ]);
}

export function runFullAnswerParsesTest(): void {
  expect(alarmRootCauseSuggestionsResponseSchema.parse(answer)).toEqual(answer);
  expect(alarmRootCauseSuggestionsResponseSchema.safeParse({ ...answer, candidates: [], context: [] }).success).toBe(
    true,
  );
}

export function runFourCandidatesRefusedTest(): void {
  const four = { ...answer, candidates: [candidate, candidate, candidate, candidate] };
  expect(alarmRootCauseSuggestionsResponseSchema.safeParse(four).success).toBe(false);
}

export function runStrengthIsAClosedWordTest(): void {
  for (const strength of ["high", 0.8, 80, "80%"]) {
    expect(rootCauseCandidateSchema.safeParse({ ...candidate, strength }).success, String(strength)).toBe(false);
  }
  for (const strength of ROOT_CAUSE_STRENGTHS) {
    expect(rootCauseCandidateSchema.safeParse({ ...candidate, strength }).success, strength).toBe(true);
  }
}

export function runUnknownRuleRefusedTest(): void {
  expect(rootCauseCandidateSchema.safeParse({ ...candidate, rule: "anomaly" }).success).toBe(false);
  expect(rootCauseEvidenceSchema.safeParse({ ...alarmEvidence, kind: "anomaly_score" }).success).toBe(false);
}

export function runNotStrictTest(): void {
  // Responses are not strict: an API newer than its web may add a key.
  expect(alarmRootCauseSuggestionsResponseSchema.safeParse({ ...answer, later: true }).success).toBe(true);
  expect(rootCauseCandidateSchema.safeParse({ ...candidate, later: 1 }).success).toBe(true);
  expect(rootCauseEvidenceSchema.safeParse({ ...alarmEvidence, later: "x" }).success).toBe(true);
  expect(rootCauseContextSchema.safeParse({ ...context, later: [] }).success).toBe(true);
}

export function runNullableQuoteAndOccurrencesTest(): void {
  const parsed = rootCauseCandidateSchema.parse({ ...candidate, quote: null, occurrences: null });
  expect(parsed.quote).toBeNull();
  expect(parsed.occurrences).toBeNull();
  expect(rootCauseCandidateSchema.safeParse({ ...candidate, occurrences: 0 }).success).toBe(false);
  // A quote is never cut, so the schema puts no length on it.
  expect(rootCauseCandidateSchema.safeParse({ ...candidate, quote: "q".repeat(5000) }).success).toBe(true);
}

export function runPointKeyBoundTest(): void {
  expect(rootCauseContextSchema.safeParse({ ...context, contributingPoints: ["p".repeat(128)] }).success).toBe(true);
  expect(rootCauseContextSchema.safeParse({ ...context, contributingPoints: ["p".repeat(129)] }).success).toBe(false);
  expect(rootCauseContextSchema.safeParse({ ...context, detectors: ["d".repeat(65)] }).success).toBe(false);
  expect(rootCauseContextSchema.safeParse({ ...context, unusualHours: 0 }).success).toBe(false);
}

export function runEvidenceCapTest(): void {
  const six = { ...candidate, evidence: Array.from({ length: 6 }, () => alarmEvidence) };
  expect(rootCauseCandidateSchema.safeParse(six).success).toBe(false);
  expect(rootCauseCandidateSchema.safeParse({ ...six, evidence: six.evidence.slice(0, 5) }).success).toBe(true);
}

export function runExactKeySetsTest(): void {
  // No score, no percentage, no user field (plan T1.1, R-i).
  expect(Object.keys(rootCauseCandidateSchema.shape).sort()).toEqual(
    ["evidence", "occurrences", "quote", "rule", "strength", "title"].sort(),
  );
  expect(Object.keys(rootCauseEvidenceSchema.shape).sort()).toEqual(
    ["alarmId", "assetCode", "assetId", "assetLocationName", "assetRtuName", "at", "endedAt", "kind", "label"].sort(),
  );
  expect(Object.keys(alarmRootCauseSuggestionsResponseSchema.shape).sort()).toEqual(
    ["candidates", "computedAt", "context"].sort(),
  );
  expect(Object.keys(rootCauseContextSchema.shape).sort()).toEqual(
    ["contributingPoints", "detectors", "from", "kind", "to", "unusualHours"].sort(),
  );
}
