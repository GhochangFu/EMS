import { z } from "zod";

/**
 * `E2.3` / ADR 0136 — `GET /api/v1/alarms/:id/root-cause-suggestions`: at most
 * three advisory candidate causes for one alarm, computed at read time from
 * rows already in the database, plus zero-weight anomaly context (decision 3).
 * Plan `docs/plans/e2.3-root-cause-suggestions.md` §4.
 *
 * Every schema is one plain `z.object` (ADR 0030): no intersection and no
 * all-readonly object, so neither `z.intersection` nor `.readonly()` applies,
 * and none is flattened from two parts. None is `.strict()`: these are
 * responses. `rule`, `strength` and the evidence `kind` are closed enums — the
 * web switches on them, and a strength is a word (decision 2): **there is no
 * number or percentage for strength anywhere in this schema.** `detectors` are
 * bounded strings, as in `ml-anomalies.ts`. The wire carries no user (R-i). The
 * types are `z.infer`, exported from this file, because `src/index.ts` sits at
 * the §4.5 cap.
 */

/** The answer holds at most this many candidates. */
export const ROOT_CAUSE_MAX_CANDIDATES = 3;

/** The anomaly context looks at this many whole UTC hours before the alarm's hour (R-g). */
export const ROOT_CAUSE_ANOMALY_LOOKBACK_HOURS = 6;

/** The rules, in the table order of plan §4 (the last ordering tie-break). */
export const ROOT_CAUSE_RULES = [
  "maintenance",
  "rtu_comms",
  "linked_alarm",
  "linked_alarm_location",
  "recorded_before",
  "class_cause",
] as const;

/** The strength words, strongest first. */
export const ROOT_CAUSE_STRENGTHS = ["strong", "moderate", "weak"] as const;

export const ROOT_CAUSE_EVIDENCE_KINDS = [
  "maintenance_window",
  "rtu_comms_alarm",
  "alarm",
  "enrichment",
  "class_philosophy",
] as const;

const isoDateTime = z.string().datetime();

/**
 * One evidence item. By kind: `maintenance_window` (`at` = start, `endedAt` =
 * effective end); `rtu_comms_alarm` (`at`, `endedAt` = cleared, `alarmId`,
 * `label` = message); `alarm` (`at`, `alarmId`, `assetId`, the three ADR 0111
 * label fields, `label` = message); `enrichment` (`at` = that alarm's raise,
 * `alarmId`); `class_philosophy` (`label` = `<template> v<version>`). Every
 * other field is null.
 */
export const rootCauseEvidenceSchema = z.object({
  kind: z.enum(ROOT_CAUSE_EVIDENCE_KINDS),
  at: isoDateTime.nullable(),
  endedAt: isoDateTime.nullable(),
  alarmId: z.string().uuid().nullable(),
  assetId: z.string().uuid().nullable(),
  // ADR 0111: so a screen prints the asset's label, not its bare code.
  assetCode: z.string().nullable(),
  assetRtuName: z.string().nullable(),
  assetLocationName: z.string().nullable(),
  label: z.string().max(300).nullable(),
});

/** One candidate cause. `quote` (R4, R5) is text a person wrote and is never cut. */
export const rootCauseCandidateSchema = z.object({
  rule: z.enum(ROOT_CAUSE_RULES),
  strength: z.enum(ROOT_CAUSE_STRENGTHS),
  title: z.string().max(300),
  quote: z.string().nullable(),
  occurrences: z.number().int().min(1).nullable(),
  evidence: z.array(rootCauseEvidenceSchema).max(5),
});

/** The zero-weight anomaly context line (decision 3): `[from, to)` is R-g's window. */
export const rootCauseContextSchema = z.object({
  kind: z.literal("anomaly"),
  from: isoDateTime,
  to: isoDateTime,
  unusualHours: z.number().int().min(1),
  detectors: z.array(z.string().max(64)),
  contributingPoints: z.array(z.string().max(128)),
});

export const alarmRootCauseSuggestionsResponseSchema = z.object({
  computedAt: isoDateTime,
  candidates: z.array(rootCauseCandidateSchema).max(ROOT_CAUSE_MAX_CANDIDATES),
  context: z.array(rootCauseContextSchema),
});

export type RootCauseRule = (typeof ROOT_CAUSE_RULES)[number];
export type RootCauseStrength = (typeof ROOT_CAUSE_STRENGTHS)[number];
export type RootCauseEvidenceKind = (typeof ROOT_CAUSE_EVIDENCE_KINDS)[number];
export type RootCauseEvidenceItem = z.infer<typeof rootCauseEvidenceSchema>;
export type RootCauseCandidate = z.infer<typeof rootCauseCandidateSchema>;
export type RootCauseContext = z.infer<typeof rootCauseContextSchema>;
export type AlarmRootCauseSuggestionsResponse = z.infer<typeof alarmRootCauseSuggestionsResponseSchema>;
