import { anomalyFindingHref, assetLabel, ML_FINDINGS_MAX_FACTS, resolveSiteTimeZone } from "@bms/shared";

import { formatFindingTime } from "./ml-findings.format";
import {
  asset,
  byOrganizationCode,
  finishCard,
  organizationOf,
  text,
  time,
  unknownAsset,
  type DraftLine,
  type DraftPart,
  type FindingOrganization,
  type FindingOrganizationDbRow,
  type FindingsCardFacts,
} from "./ml-findings.lines";

/**
 * `E1.9a` / ADR 0135 Amendment 8 decision 2 (plan §4.3, R-k, R-l) — the anomaly
 * fact sentences of each organization, from the findings read's one row per
 * scored asset. Pure: no database; the request's one clock is passed in.
 *
 * The read has already taken the newest succeeded run per hour and detector,
 * then `ANOMALY_UNUSUAL_SCORE`, and counted an hour two detectors mark once
 * (`anomalyFindingsStatement` in `ml-anomalies.reads.ts`), so nothing here
 * compares a score. The calibration caveat shapes the words: a mark from the
 * Baseline method alone is described as weak, and assets marked by both
 * methods are named first (A2), as the strongest signal.
 */
const MAX_LINES = ML_FINDINGS_MAX_FACTS;
const MAX_A2 = 2;
const MAX_A3 = 5;
const SHOWN_POINTS = 3;

export const BASELINE_ONLY_SENTENCE =
  "All marks come from the Baseline method only. On their own they are a weak signal while that method's marking rate is being checked.";
export const MIXED_SENTENCE =
  "Marks from the Baseline method alone are a weak signal; marks from both methods are the strongest.";

/** One row of the anomaly findings read: one scored asset in the window, every column aliased. */
export type AnomalyFindingDbRow = {
  asset_id: string;
  unusual_hours: number;
  both_hours: number;
  baseline_only_hours: number;
  last_unusual_ms: number | null;
  /** The last unusual hour's contributing points, one list per marking detector, in detector order. */
  last_points: string[][] | null;
  organization_id: string;
  organization_code: string | null;
  organization_name: string | null;
  asset_code: string;
  asset_rtu_name: string | null;
  location_name: string;
  location_time_zone: string | null;
  organization_time_zone: string | null;
};

export type AnomalyFindingsInput = {
  readonly rows: readonly AnomalyFindingDbRow[];
  /** Q1(a): the organizations in scope with any ML row; one with no scored asset gets the `A_NONE` card. */
  readonly organizations: readonly FindingOrganizationDbRow[];
};

type Scored = {
  readonly assetId: string;
  readonly organization: FindingOrganization;
  readonly code: string;
  readonly label: string;
  readonly zone: string;
  readonly unusual: number;
  readonly both: number;
  readonly baselineOnly: number;
  readonly lastMs: number | null;
  readonly points: readonly string[];
};

function scoredOf(row: AnomalyFindingDbRow): Scored {
  const points: string[] = [];
  for (const list of row.last_points ?? []) {
    for (const key of list ?? []) if (!points.includes(key)) points.push(key);
  }
  return {
    assetId: row.asset_id,
    organization: organizationOf(row),
    code: row.asset_code,
    label: assetLabel({ code: row.asset_code, rtuName: row.asset_rtu_name, locationName: row.location_name }),
    zone: resolveSiteTimeZone(row.location_time_zone, row.organization_time_zone).arithmeticZone,
    unusual: Number(row.unusual_hours),
    both: Number(row.both_hours),
    baselineOnly: Number(row.baseline_only_hours),
    lastMs: row.last_unusual_ms === null ? null : Number(row.last_unusual_ms),
    points,
  };
}

/** `1 hour`, `2 hours`: the count with its noun, singular for exactly one. */
const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const newer = (a: Scored, b: Scored): number => (b.lastMs ?? 0) - (a.lastMs ?? 0);

/** `; points a, b, c` with at most 3 shown; nothing when the hour named none. */
const pointsClause = (s: Scored): string =>
  s.points.length === 0 ? "" : `; points ${s.points.slice(0, SHOWN_POINTS).join(", ")}`;

const last = (s: Scored): DraftPart => time(formatFindingTime(s.lastMs ?? 0, s.zone));

function a2(s: Scored, more: number): DraftLine {
  const tail = more > 0 ? `; and ${count(more, "more asset", "more assets")} with marks from both methods.` : ".";
  return {
    id: "A2",
    parts: [
      text("Strongest signal: "),
      asset(s.assetId),
      text(` — ${count(s.both, "hour", "hours")} marked by both methods, ${count(s.unusual, "unusual hour", "unusual hours")} in all; last `),
      last(s),
      text(`${pointsClause(s)}${tail}`),
    ],
  };
}

function a3(s: Scored): DraftLine {
  return {
    id: "A3",
    parts: [asset(s.assetId), text(`: ${count(s.unusual, "unusual hour", "unusual hours")}, last `), last(s), text(`${pointsClause(s)}.`)],
  };
}

function cardFor(organization: FindingOrganization, scored: readonly Scored[], asOfMs: number): FindingsCardFacts {
  const byId = new Map(scored.map((s) => [s.assetId, s]));
  const finish = (lines: DraftLine[]) =>
    finishCard(
      organization,
      lines,
      (id) => byId.get(id) ?? unknownAsset(id),
      (id) => {
        const s = byId.get(id);
        return anomalyFindingHref(id, s?.lastMs ?? Number.NaN, asOfMs, s?.points ?? []);
      },
    );
  const marked = scored.filter((s) => s.unusual > 0);
  const hours = marked.reduce((sum, s) => sum + s.unusual, 0);
  if (hours === 0) {
    return finish([{ id: "A_NONE", parts: [text(`No unusual hours in the last 7 days on ${count(scored.length, "scored asset", "scored assets")}.`)] }]);
  }
  const line1: DraftLine = {
    id: "A1",
    parts: [text(
      `${count(hours, "unusual hour", "unusual hours")} in the last 7 days, on ${marked.length} of ${count(scored.length, "scored asset", "scored assets")}.`,
    )],
  };
  const strongest = marked
    .filter((s) => s.both > 0)
    .sort((a, b) => b.both - a.both || b.unusual - a.unusual || newer(a, b) || a.label.localeCompare(b.label));
  const named = strongest.slice(0, MAX_A2);
  const more = strongest.length - named.length;
  const lines2 = named.map((s, i) => a2(s, i === named.length - 1 ? more : 0));
  const namedIds = new Set(named.map((s) => s.assetId));
  const baselineOnly = marked.reduce((sum, s) => sum + s.baselineOnly, 0) === hours;
  const line4: DraftLine = { id: "A4", parts: [text(baselineOnly ? BASELINE_ONLY_SENTENCE : MIXED_SENTENCE)] };
  const room = Math.min(MAX_A3, MAX_LINES - 2 - lines2.length);
  const lines3 = marked
    .filter((s) => !namedIds.has(s.assetId))
    .sort((a, b) => b.unusual - a.unusual || newer(a, b) || a.label.localeCompare(b.label))
    .slice(0, Math.max(room, 0))
    .map(a3);
  return finish([line1, ...lines2, ...lines3, line4]);
}

/** One card per organization, by organization code (decision 2, Q1(a)). */
export function buildAnomalyCards(input: AnomalyFindingsInput, now: Date): FindingsCardFacts[] {
  const scored = input.rows.map(scoredOf);
  const organizations = new Map<string, FindingOrganization>();
  for (const s of scored) organizations.set(s.organization.organizationId, s.organization);
  for (const row of input.organizations) {
    if (!organizations.has(row.organization_id)) organizations.set(row.organization_id, organizationOf(row));
  }
  return byOrganizationCode(
    [...organizations.values()].map((org) =>
      cardFor(
        org,
        scored.filter((s) => s.organization.organizationId === org.organizationId),
        now.getTime(),
      ),
    ),
  );
}
