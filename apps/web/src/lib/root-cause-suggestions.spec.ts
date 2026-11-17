import { expect } from "vitest";

import type { RootCauseCandidate, RootCauseContext, RootCauseEvidenceItem } from "@bms/shared/contracts";

import {
  anomalyContextLine,
  candidateHeading,
  evidenceLine,
  holdsText,
  ROOT_CAUSE_FILL_MAX,
  rootCauseFillText,
  strengthWord,
} from "./root-cause-suggestions";

/**
 * `E2.3` (ADR 0136 decision 6, plan §7 T2.2) — the words the "Possible causes — advisory"
 * section prints, and the one text "Use as root cause" may put in the form.
 */

function candidate(overrides: Partial<RootCauseCandidate> = {}): RootCauseCandidate {
  return {
    rule: "maintenance",
    strength: "strong",
    title: "Maintenance on this asset",
    quote: null,
    occurrences: null,
    evidence: [],
    ...overrides,
  };
}

function evidence(overrides: Partial<RootCauseEvidenceItem>): RootCauseEvidenceItem {
  return {
    kind: "alarm",
    at: null,
    endedAt: null,
    alarmId: null,
    assetId: null,
    assetCode: null,
    assetRtuName: null,
    assetLocationName: null,
    label: null,
    ...overrides,
  };
}

/** R1–R3 read as their title; R4 and R5 quote what a person wrote, R4 with its count from 2. */
export function eachHeading(): void {
  expect(candidateHeading(candidate())).toBe("Maintenance on this asset");
  expect(candidateHeading(candidate({ rule: "linked_alarm", title: 'Linked to "Low flow"' }))).toBe('Linked to "Low flow"');
  expect(
    candidateHeading(candidate({ rule: "recorded_before", title: "Recorded before", quote: "Grease line cracked", occurrences: 1 })),
  ).toBe('Recorded before: "Grease line cracked"');
  expect(
    candidateHeading(candidate({ rule: "recorded_before", title: "Recorded before", quote: "Grease line cracked", occurrences: 3 })),
  ).toBe('Recorded before: "Grease line cracked" · recorded 3 times');
  expect(candidateHeading(candidate({ rule: "class_cause", title: "Class cause", quote: "Lubrication starvation" }))).toBe(
    'Class cause: "Lubrication starvation"',
  );
}

/** A strength is a word, never a number (decision 2). */
export function theStrengthWords(): void {
  expect([strengthWord("strong"), strengthWord("moderate"), strengthWord("weak")]).toEqual(["Strong", "Moderate", "Weak"]);
}

/** R5 gives no fill text: class text never becomes an instance root cause (ADR 0059 Q1). */
export function theClassCauseGivesNoFillText(): void {
  expect(rootCauseFillText(candidate({ rule: "class_cause", title: "Class cause", quote: "Lubrication starvation" }))).toBeNull();
}

/** An R4 fill is the quote alone, not the heading; R1–R3 fill their title. */
export function aFillIsTheQuoteOrTheTitle(): void {
  expect(
    rootCauseFillText(candidate({ rule: "recorded_before", title: "Recorded before", quote: "Grease line cracked", occurrences: 3 })),
  ).toBe("Grease line cracked");
  expect(rootCauseFillText(candidate())).toBe("Maintenance on this asset");
}

/** A 2,500-character quote is cut to the field's 2000. */
export function aLongQuoteIsCutToTheFieldLimit(): void {
  const filled = rootCauseFillText(candidate({ rule: "recorded_before", quote: "x".repeat(2500), occurrences: 1 }));
  expect(ROOT_CAUSE_FILL_MAX).toBe(2000);
  expect(filled).toHaveLength(2000);
}

/** Only a non-blank string holds text. */
export function holdsTextIsANonBlankString(): void {
  expect([holdsText("a"), holdsText("  "), holdsText(""), holdsText(null), holdsText(undefined), holdsText(3)]).toEqual([
    true,
    false,
    false,
    false,
    false,
    false,
  ]);
}

/** Each evidence kind reads as a sentence that names what it is, and never prints "null". */
export function theEvidenceLines(): void {
  const at = "2026-11-17T09:40:00.000Z";
  const window = evidenceLine(evidence({ kind: "maintenance_window", at, endedAt: "2026-11-17T09:50:00.000Z" }));
  expect(window).toMatch(/^Maintenance window from .+ to .+$/);
  expect(evidenceLine(evidence({ kind: "rtu_comms_alarm", at, label: "Communication lost: RTU 1" }))).toMatch(
    /^RTU communication alarm raised .+: Communication lost: RTU 1$/,
  );
  expect(
    evidenceLine(evidence({ kind: "alarm", at, assetCode: "PMP-02", assetRtuName: "RTU 1", assetLocationName: "Plant A", label: "Low flow" })),
  ).toMatch(/^PMP-02 · RTU 1, raised .+: Low flow$/);
  expect(evidenceLine(evidence({ kind: "enrichment", at }))).toMatch(/^Recorded on the alarm raised .+$/);
  expect(evidenceLine(evidence({ kind: "class_philosophy", label: "Centrifugal pump v3" }))).toBe("From Centrifugal pump v3");
  for (const kind of ["maintenance_window", "rtu_comms_alarm", "alarm", "enrichment", "class_philosophy"] as const) {
    expect(evidenceLine(evidence({ kind }))).not.toMatch(/null|undefined|Invalid Date/);
  }
}

/** The context sentence says advisory and names the detectors by label and the points by key. */
export function theContextSentenceIsAdvisory(): void {
  const ctx: RootCauseContext = {
    kind: "anomaly",
    from: "2026-11-17T03:00:00.000Z",
    to: "2026-11-17T09:00:00.000Z",
    unusualHours: 2,
    detectors: ["baseline_mad", "isolation_forest"],
    contributingPoints: ["kw", "pf"],
  };
  expect(anomalyContextLine(ctx)).toBe(
    "Readings on this asset were unusual in the 6 h before the alarm (advisory, detector Baseline, Isolation Forest, points kw, pf).",
  );
  expect(anomalyContextLine({ ...ctx, contributingPoints: [] })).toBe(
    "Readings on this asset were unusual in the 6 h before the alarm (advisory, detector Baseline, Isolation Forest).",
  );
}
