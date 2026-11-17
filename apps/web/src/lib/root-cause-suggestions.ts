import { assetLabelOf } from "@bms/shared";
import {
  ALARM_ENRICHMENT_TEXT_MAX,
  ROOT_CAUSE_ANOMALY_LOOKBACK_HOURS,
  type RootCauseCandidate,
  type RootCauseContext,
  type RootCauseEvidenceItem,
  type RootCauseStrength,
} from "@bms/shared/contracts";

import { detectorLabel } from "./anomaly-series";

/**
 * `E2.3` (ADR 0136 decision 6, plan §7 T2.2) — the words the alarm panel's "Possible causes —
 * advisory" section prints, and the one text "Use as root cause" may put in the form. Pure, so
 * every sentence is held by a unit test and not by a screenshot.
 */

/** The enrichment form's `rootCause` limit: the server's own (`alarmEnrichmentUpsertBodySchema`). */
export const ROOT_CAUSE_FILL_MAX = ALARM_ENRICHMENT_TEXT_MAX;

/** The candidate's heading: R4 and R5 quote what a person wrote; R4 adds its count from 2. */
export function candidateHeading(c: RootCauseCandidate): string {
  if (c.rule === "recorded_before" && c.quote !== null) {
    const times = c.occurrences !== null && c.occurrences >= 2 ? ` · recorded ${c.occurrences} times` : "";
    return `Recorded before: "${c.quote}"${times}`;
  }
  if (c.rule === "class_cause" && c.quote !== null) {
    return `Class cause: "${c.quote}"`;
  }
  return c.title;
}

const STRENGTH_WORDS: Readonly<Record<RootCauseStrength, string>> = {
  strong: "Strong",
  moderate: "Moderate",
  weak: "Weak",
};

/** A strength is a word, never a number (decision 2). */
export function strengthWord(s: RootCauseStrength): string {
  return STRENGTH_WORDS[s];
}

/**
 * What "Use as root cause" puts in the field, or `null` for no button. **R5 (`class_cause`) is
 * always `null`**: class text never becomes an instance root cause (ADR 0059 Q1, ADR 0136's
 * drafter call). Otherwise the quote alone (never the heading), else the title, cut to the
 * field's limit.
 */
export function rootCauseFillText(c: RootCauseCandidate): string | null {
  if (c.rule === "class_cause") {
    return null;
  }
  return (c.quote ?? c.title).slice(0, ROOT_CAUSE_FILL_MAX);
}

/** A non-blank string. */
export function holdsText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** An instant in the browser's locale, as the panel's own "Triggered" line; unreadable reads as a dash. */
function when(iso: string | null): string {
  if (iso === null) return "—";
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toLocaleString() : "—";
}

const withLabel = (head: string, label: string | null): string => (label === null ? head : `${head}: ${label}`);

/** One evidence item as a sentence. No item links (plan R-m). */
export function evidenceLine(e: RootCauseEvidenceItem): string {
  switch (e.kind) {
    case "maintenance_window":
      return `Maintenance window from ${when(e.at)} to ${when(e.endedAt)}`;
    case "rtu_comms_alarm":
      return withLabel(`RTU communication alarm raised ${when(e.at)}`, e.label);
    case "alarm": {
      // ADR 0111: the asset's label, not its bare code.
      const asset = e.assetCode === null ? "Alarm" : `${assetLabelOf({ ...e, assetCode: e.assetCode })},`;
      return withLabel(`${asset} raised ${when(e.at)}`, e.label);
    }
    case "enrichment":
      return `Recorded on the alarm raised ${when(e.at)}`;
    case "class_philosophy":
      return e.label === null ? "From the class philosophy" : `From ${e.label}`;
  }
}

/** The zero-weight anomaly context line (decision 3): it says advisory, every time. */
export function anomalyContextLine(ctx: RootCauseContext): string {
  const detectors = ctx.detectors.length > 0 ? `, detector ${ctx.detectors.map(detectorLabel).join(", ")}` : "";
  const points = ctx.contributingPoints.length > 0 ? `, points ${ctx.contributingPoints.join(", ")}` : "";
  return `Readings on this asset were unusual in the ${ROOT_CAUSE_ANOMALY_LOOKBACK_HOURS} h before the alarm (advisory${detectors}${points}).`;
}
