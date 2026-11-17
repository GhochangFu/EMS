import {
  ANOMALY_UNUSUAL_SCORE,
  ROOT_CAUSE_ANOMALY_LOOKBACK_HOURS,
  ROOT_CAUSE_MAX_CANDIDATES,
  ROOT_CAUSE_RULES,
  ROOT_CAUSE_STRENGTHS,
  type AlarmClassPhilosophy,
  type AlarmRootCauseSuggestionsResponse,
  type RootCauseCandidate,
  type RootCauseContext,
  type RootCauseEvidenceItem,
  type RootCauseRule,
  type RootCauseStrength,
} from "@bms/shared";

import type { AssetAnomalyDbRow } from "../ml/ml-anomalies.pure";
import { HOUR_MS, currentHourOf } from "../ml/ml-forecasts.pure";

import { windowCovers } from "./maintenance-cover";

/**
 * `E2.3` / ADR 0136 decisions 2 and 3 — the pure step of the root-cause
 * suggestions (plan `docs/plans/e2.3-root-cause-suggestions.md` §4, T1.2). No
 * database and no clock: the reads (`alarm-root-cause.reads.ts`) hand rows in,
 * the service hands the request's one clock in.
 *
 * Every rule re-applies its own window here, so a read that returns a row too
 * many changes no answer. **{@link rankRootCauseCandidates} cannot see an
 * anomaly row** (R-h): its input type has no anomaly member, and the context
 * line is built by the separate {@link anomalyContextOf}. That is the type half
 * of decision 3's zero weight; the spec and the integration suite are the rest.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * HOUR_MS;

/** R1: a window that ended within this long before `T` still counts. */
export const ROOT_CAUSE_MAINTENANCE_LOOKBACK_MS = 60 * MINUTE_MS;
/** R2: an `rtu_comms` alarm raised within this long before `T`. */
export const ROOT_CAUSE_RTU_COMMS_LOOKBACK_MS = 60 * MINUTE_MS;
/** R3 / R3b: another `rule` alarm raised within this long before `T` (R-f: `T` itself included). */
export const ROOT_CAUSE_LINKED_LOOKBACK_MS = 30 * MINUTE_MS;
/** R4: earlier alarms of the same rule and asset within this long before `T` (strictly before `T`). */
export const ROOT_CAUSE_RECORDED_LOOKBACK_MS = 180 * DAY_MS;

/** Row caps the SQL applies (plan §4). R2 and R3 are capped each by itself. */
export const ROOT_CAUSE_WINDOW_ROW_CAP = 50;
export const ROOT_CAUSE_RTU_COMMS_ROW_CAP = 20;
export const ROOT_CAUSE_LINKED_ROW_CAP = 20;
export const ROOT_CAUSE_RECORDED_ROW_CAP = 50;

/** Evidence items per candidate, newest first. */
export const ROOT_CAUSE_EVIDENCE_PER_CANDIDATE = 5;
/** An alarm message in a title or label is cut at this many characters, with `…`. A quote is never cut. */
export const ROOT_CAUSE_MESSAGE_MAX_CHARS = 200;

/** The subject alarm `S` (a `rule` alarm with an asset) and what its rules are judged on. */
export type RootCauseSubject = {
  readonly alarmId: string;
  readonly organizationId: string;
  /** `T`, epoch milliseconds. */
  readonly raisedAtMs: number;
  readonly assetId: string;
  /** `null` when the rule was deleted: no R4 then. */
  readonly ruleId: string | null;
  /** The asset's RTU; `null` gives no R2 and no same-RTU R3. */
  readonly rtuId: string | null;
  /** The RTU's display name, for R2's title. */
  readonly rtuName: string | null;
  readonly locationId: string;
  /** Ancestor-or-self of `locationId` (`locationAncestors`), for R1's location targets. */
  readonly locationAncestorIds: readonly string[];
};

/** A maintenance window with its targets split by kind. `endMs` is `COALESCE(ended_at, ends_at)`. */
export type RootCauseWindowRow = {
  readonly id: string;
  readonly organizationId: string;
  readonly startsMs: number;
  readonly endMs: number;
  readonly assetIds: readonly string[];
  readonly locationIds: readonly string[];
  readonly ruleIds: readonly string[];
};

/**
 * One alarm row of the R2 + R3 statement. The `asset*` columns describe the
 * alarm's asset (null on an `rtu_comms` row); `rtuId` is the alarm's own
 * `rtu_id` (set on an `rtu_comms` row).
 */
export type RootCauseAlarmRow = {
  readonly id: string;
  readonly source: string;
  readonly assetId: string | null;
  readonly ruleId: string | null;
  readonly rtuId: string | null;
  readonly message: string;
  readonly raisedMs: number;
  readonly clearedMs: number | null;
  readonly assetCode: string | null;
  readonly assetRtuId: string | null;
  readonly assetLocationId: string | null;
  readonly assetRtuName: string | null;
  readonly assetLocationName: string | null;
};

/** One earlier alarm of the subject's rule and asset, with the root cause its enrichment recorded. */
export type RootCausePastRow = {
  readonly alarmId: string;
  readonly raisedMs: number;
  readonly rootCause: string;
};

/** R5's source: the alarm details' `classPhilosophy`. */
export type RootCauseClassCause = Pick<AlarmClassPhilosophy, "cause" | "templateName" | "templateVersion">;

/** Everything the ranking sees. **No anomaly member** (R-h). */
export type RootCauseEvidence = {
  readonly subject: RootCauseSubject;
  readonly windows: readonly RootCauseWindowRow[];
  readonly rtuCommsAlarms: readonly RootCauseAlarmRow[];
  readonly relatedAlarms: readonly RootCauseAlarmRow[];
  readonly pastRootCauses: readonly RootCausePastRow[];
  readonly classCause: RootCauseClassCause | null;
};

const iso = (ms: number): string => new Date(ms).toISOString();

/** Cuts an alarm message at 200 characters with `…`, never splitting a surrogate pair. */
export function cutMessage(message: string): string {
  if (message.length <= ROOT_CAUSE_MESSAGE_MAX_CHARS) return message;
  let cut = message.slice(0, ROOT_CAUSE_MESSAGE_MAX_CHARS);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut}…`;
}

const blankEvidence = (kind: RootCauseEvidenceItem["kind"]): RootCauseEvidenceItem => ({
  kind,
  at: null,
  endedAt: null,
  alarmId: null,
  assetId: null,
  assetCode: null,
  assetRtuName: null,
  assetLocationName: null,
  label: null,
});

/** A candidate before the cut, with what the order needs. */
type Ranked = { candidate: RootCauseCandidate; recencyMs: number | null };

const candidateOf = (
  rule: RootCauseRule,
  strength: RootCauseStrength,
  title: string,
  evidence: RootCauseEvidenceItem[],
  extra: { quote?: string; occurrences?: number } = {},
): RootCauseCandidate => ({
  rule,
  strength,
  title,
  quote: extra.quote ?? null,
  occurrences: extra.occurrences ?? null,
  evidence: evidence.slice(0, ROOT_CAUSE_EVIDENCE_PER_CANDIDATE),
});

const byNewestAlarm = (a: RootCauseAlarmRow, b: RootCauseAlarmRow): number =>
  b.raisedMs - a.raisedMs || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** R1 (R-d): windows that cover the asset through an asset or location target, overlapping `[T − 60 min, T]`. */
function maintenanceCandidate(subject: RootCauseSubject, windows: readonly RootCauseWindowRow[]): Ranked | null {
  const T = subject.raisedAtMs;
  const covering = windows.filter(
    (w) =>
      w.startsMs <= T &&
      w.endMs > T - ROOT_CAUSE_MAINTENANCE_LOOKBACK_MS &&
      // A window cancelled before it started (`ended_at < starts_at`) never ran.
      w.endMs > w.startsMs &&
      windowCovers(
        { ...w, startsAt: new Date(w.startsMs) },
        {
          source: "rule",
          organizationId: subject.organizationId,
          assetId: subject.assetId,
          // R-d: a rule-only window did not cover the asset.
          ruleId: null,
          locationAncestorIds: subject.locationAncestorIds,
        },
      ),
  );
  if (covering.length === 0) return null;
  const sorted = [...covering].sort((a, b) => b.startsMs - a.startsMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const evidence = sorted.map((w) => ({ ...blankEvidence("maintenance_window"), at: iso(w.startsMs), endedAt: iso(w.endMs) }));
  return {
    candidate: candidateOf("maintenance", "strong", "Maintenance on this asset", evidence),
    recencyMs: Math.max(...covering.map((w) => Math.min(w.endMs, T))),
  };
}

/** R2 (Q1 (a)): `rtu_comms` alarms on the asset's RTU raised in `[T − 60 min, T]`. */
function rtuCommsCandidate(subject: RootCauseSubject, rows: readonly RootCauseAlarmRow[]): Ranked | null {
  const T = subject.raisedAtMs;
  if (subject.rtuId === null) return null;
  const matching = rows
    .filter(
      (r) =>
        r.source === "rtu_comms" &&
        r.id !== subject.alarmId &&
        r.rtuId === subject.rtuId &&
        r.raisedMs >= T - ROOT_CAUSE_RTU_COMMS_LOOKBACK_MS &&
        r.raisedMs <= T,
    )
    .sort(byNewestAlarm);
  if (matching.length === 0) return null;
  const evidence = matching.map((r) => ({
    ...blankEvidence("rtu_comms_alarm"),
    at: iso(r.raisedMs),
    endedAt: r.clearedMs === null ? null : iso(r.clearedMs),
    alarmId: r.id,
    label: cutMessage(r.message),
  }));
  const title =
    subject.rtuName === null
      ? "Communication or power loss at this asset's RTU"
      : `Communication or power loss at RTU ${subject.rtuName}`;
  return { candidate: candidateOf("rtu_comms", "strong", title, evidence), recencyMs: matching[0]!.raisedMs };
}

/** R3 and R3b (R-e, R-f): other `rule` alarms raised in `[T − 30 min, T]`, never a re-raise of `S`'s rule on `S`'s asset. */
function linkedCandidates(subject: RootCauseSubject, rows: readonly RootCauseAlarmRow[]): Ranked[] {
  const T = subject.raisedAtMs;
  const sameAssetOrRtu: RootCauseAlarmRow[] = [];
  const sameLocation: RootCauseAlarmRow[] = [];
  for (const r of rows) {
    if (r.source !== "rule" || r.id === subject.alarmId) continue;
    if (r.raisedMs < T - ROOT_CAUSE_LINKED_LOOKBACK_MS || r.raisedMs > T) continue;
    const sameAsset = r.assetId === subject.assetId;
    if (sameAsset && subject.ruleId !== null && r.ruleId === subject.ruleId) continue; // R4's population
    const sameRtu = subject.rtuId !== null && r.assetRtuId === subject.rtuId;
    if (sameAsset || sameRtu) sameAssetOrRtu.push(r);
    else if (r.assetLocationId === subject.locationId) sameLocation.push(r);
  }
  const ranked: Ranked[] = [];
  const push = (rule: RootCauseRule, strength: RootCauseStrength, group: RootCauseAlarmRow[]): void => {
    if (group.length === 0) return;
    const sorted = group.sort(byNewestAlarm);
    const evidence = sorted.map((r) => ({
      ...blankEvidence("alarm"),
      at: iso(r.raisedMs),
      alarmId: r.id,
      assetId: r.assetId,
      assetCode: r.assetCode,
      assetRtuName: r.assetRtuName,
      assetLocationName: r.assetLocationName,
      label: cutMessage(r.message),
    }));
    const title = `Linked to "${cutMessage(sorted[0]!.message)}"`;
    ranked.push({ candidate: candidateOf(rule, strength, title, evidence), recencyMs: sorted[0]!.raisedMs });
  };
  push("linked_alarm", "moderate", sameAssetOrRtu);
  push("linked_alarm_location", "weak", sameLocation);
  return ranked;
}

/** R4: earlier root causes of `S`'s rule on `S`'s asset in `[T − 180 d, T)`, grouped by trimmed, case-folded text. */
function recordedBeforeCandidates(subject: RootCauseSubject, rows: readonly RootCausePastRow[]): Ranked[] {
  const T = subject.raisedAtMs;
  if (subject.ruleId === null) return [];
  const groups = new Map<string, RootCausePastRow[]>();
  for (const r of rows) {
    if (r.alarmId === subject.alarmId) continue;
    if (r.raisedMs >= T || r.raisedMs < T - ROOT_CAUSE_RECORDED_LOOKBACK_MS) continue;
    const text = r.rootCause.trim();
    if (text === "") continue;
    const key = text.toLowerCase();
    const group = groups.get(key);
    if (group) group.push(r);
    else groups.set(key, [r]);
  }
  return [...groups.values()].map((group) => {
    const sorted = group.sort(
      (a, b) => b.raisedMs - a.raisedMs || (a.alarmId < b.alarmId ? 1 : a.alarmId > b.alarmId ? -1 : 0),
    );
    const newest = sorted[0]!;
    const evidence = sorted.map((r) => ({ ...blankEvidence("enrichment"), at: iso(r.raisedMs), alarmId: r.alarmId }));
    const strength: RootCauseStrength = group.length >= 2 ? "moderate" : "weak";
    return {
      candidate: candidateOf("recorded_before", strength, "Recorded before", evidence, {
        quote: newest.rootCause.trim(),
        occurrences: group.length,
      }),
      recencyMs: newest.raisedMs,
    };
  });
}

/** R5: the class philosophy's cause, weak and undated. */
function classCauseCandidate(classCause: RootCauseClassCause | null): Ranked | null {
  if (classCause === null || classCause.cause === null || classCause.cause.trim() === "") return null;
  const evidence = [
    { ...blankEvidence("class_philosophy"), label: `${classCause.templateName} v${classCause.templateVersion}` },
  ];
  return {
    candidate: candidateOf("class_cause", "weak", "Class cause", evidence, { quote: classCause.cause }),
    recencyMs: null,
  };
}

/** Plan §4's order: strength; recency, newest first, undated last; the table's order; R4 groups by occurrences, then quote. */
function compareRanked(a: Ranked, b: Ranked): number {
  const strength = ROOT_CAUSE_STRENGTHS.indexOf(a.candidate.strength) - ROOT_CAUSE_STRENGTHS.indexOf(b.candidate.strength);
  if (strength !== 0) return strength;
  if (a.recencyMs !== b.recencyMs) {
    if (a.recencyMs === null) return 1;
    if (b.recencyMs === null) return -1;
    return b.recencyMs - a.recencyMs;
  }
  const rule = ROOT_CAUSE_RULES.indexOf(a.candidate.rule) - ROOT_CAUSE_RULES.indexOf(b.candidate.rule);
  if (rule !== 0) return rule;
  const occurrences = (b.candidate.occurrences ?? 0) - (a.candidate.occurrences ?? 0);
  if (occurrences !== 0) return occurrences;
  const qa = a.candidate.quote ?? "";
  const qb = b.candidate.quote ?? "";
  return qa < qb ? -1 : qa > qb ? 1 : 0;
}

/** Decision 2: at most three candidates from the rules of plan §4, each with up to 5 evidence items. */
export function rankRootCauseCandidates(evidence: RootCauseEvidence): RootCauseCandidate[] {
  const { subject } = evidence;
  const ranked: Ranked[] = [
    maintenanceCandidate(subject, evidence.windows),
    rtuCommsCandidate(subject, evidence.rtuCommsAlarms),
    ...linkedCandidates(subject, evidence.relatedAlarms),
    ...recordedBeforeCandidates(subject, evidence.pastRootCauses),
    classCauseCandidate(evidence.classCause),
  ].filter((r): r is Ranked => r !== null);
  return ranked
    .sort(compareRanked)
    .slice(0, ROOT_CAUSE_MAX_CANDIDATES)
    .map((r) => r.candidate);
}

/**
 * R-g: the six whole UTC hours that ended at or before the alarm's hour began,
 * `[floorHour(T) − 6 h, floorHour(T))`. The alarm's own hour is scored after it.
 */
export function anomalyWindowBefore(raisedAtMs: number): { fromHourMs: number; endMs: number } {
  const hour = currentHourOf(new Date(raisedAtMs));
  return { fromHourMs: hour - ROOT_CAUSE_ANOMALY_LOOKBACK_HOURS * HOUR_MS, endMs: hour };
}

/**
 * Decision 3, zero weight: one context item when any row in the window scores
 * at or above `ANOMALY_UNUSUAL_SCORE`, else none. The rows are already the
 * newest run per hour and detector (`readAssetAnomalies`).
 */
export function anomalyContextOf(
  rows: readonly AssetAnomalyDbRow[],
  window: { fromHourMs: number; endMs: number },
): RootCauseContext[] {
  const kept = rows.filter(
    (r) => r.bucket_ms >= window.fromHourMs && r.bucket_ms < window.endMs && r.score >= ANOMALY_UNUSUAL_SCORE,
  );
  if (kept.length === 0) return [];
  const sortedDistinct = (values: readonly string[]): string[] => [...new Set(values)].sort();
  return [
    {
      kind: "anomaly",
      from: iso(window.fromHourMs),
      to: iso(window.endMs),
      unusualHours: new Set(kept.map((r) => r.bucket_ms)).size,
      detectors: sortedDistinct(kept.map((r) => r.detector)),
      contributingPoints: sortedDistinct(kept.flatMap((r) => r.contributing_points)).slice(0, 5),
    },
  ];
}

/** The whole answer for a subject with an asset. The candidates never see `anomalyRows`. */
export function buildRootCauseSuggestions(
  evidence: RootCauseEvidence,
  anomalyRows: readonly AssetAnomalyDbRow[],
  now: Date,
): AlarmRootCauseSuggestionsResponse {
  return {
    computedAt: now.toISOString(),
    candidates: rankRootCauseCandidates(evidence),
    context: anomalyContextOf(anomalyRows, anomalyWindowBefore(evidence.subject.raisedAtMs)),
  };
}
