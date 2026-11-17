import { assetLabel, forecastFindingHref, ML_FINDINGS_MAX_FACTS, resolveSiteTimeZone } from "@bms/shared";

import { crossingsOf, type Crossing, type CrossingPoint, type CrossingRule } from "./ml-findings.crossings";
import { formatFindingTime, formatFindingValue, formatSignedChange, tempWords } from "./ml-findings.format";
import {
  asset,
  byOrganizationCode,
  finishCard,
  organizationOf,
  rule,
  text,
  time,
  unknownAsset,
  type AssetName,
  type DraftLine,
  type FindingOrganization,
  type FindingOrganizationDbRow,
  type FindingsCardFacts,
} from "./ml-findings.lines";
import { currentHourOf, isStale } from "./ml-forecasts.pure";

/**
 * `E1.9a` / ADR 0135 Amendment 8 decision 2 (plan §4.1, §4.2, R-h, R-j, R-r) —
 * the forecast fact sentences of each organization, from the rows the findings
 * reads return. Pure: no database; the request's one clock is passed in.
 *
 * Per point the current run (Amendment 3 C3), its 48 whole hours from the
 * current UTC hour. Point keys by their number of points, then by key; the
 * first 3 are used and `F_MORE` covers the rest. Values of two point keys are
 * never compared: F2–F4 are one line per key. At most 8 lines, kept in R-h's
 * order (F1, F5, then F2, F3, F4 of each key; `F_MORE` keeps its place) and
 * shown in the table's (F1, F2, F3, F4, F5, F_MORE).
 */
const MAX_KEYS = 3;
const MAX_LINES = ML_FINDINGS_MAX_FACTS;
/** F3: a point with fewer actual hours than this in the last 24 is left out (decision 2). */
export const F3_MIN_ACTUAL_HOURS = 12;

/** One row of the findings read: one point and one bucket, every column aliased. */
export type ForecastFindingDbRow = {
  asset_id: string;
  point_key: string;
  issued_ms: number;
  first_bucket_ms: number;
  bucket_ms: number;
  p10: number;
  p50: number;
  p90: number;
  organization_id: string;
  organization_code: string | null;
  organization_name: string | null;
  asset_code: string;
  asset_rtu_name: string | null;
  location_name: string;
  location_time_zone: string | null;
  organization_time_zone: string | null;
  unit: string | null;
};

/** One row of the 24 h means read. */
export type ActualMeanDbRow = { asset_id: string; point_key: string; mean_24h: number | null; hours: number };

/** One row of the rule read. The severity is never selected. */
export type ThresholdRuleDbRow = {
  rule_id: string;
  asset_id: string;
  point_key: string;
  rule_name: string;
  operator: string;
  threshold_value: number | null;
  rule_unit: string | null;
  rule_type: string;
  rule_window: string | null;
};

export type ForecastFindingsInput = {
  readonly rows: readonly ForecastFindingDbRow[];
  readonly means: readonly ActualMeanDbRow[];
  readonly rules: readonly ThresholdRuleDbRow[];
  /** Q1(a): the organizations in scope with any ML row; one without a forecast point gets the `F_NONE` card. */
  readonly organizations: readonly FindingOrganizationDbRow[];
  /** A location, asset group or asset narrows the request (R-r). */
  readonly narrowed: boolean;
};

type Point = CrossingPoint & {
  /** `E1.9g`: the asset code alone, for the card's asset entry (`label` stays the full label). */
  readonly code: string;
  readonly organization: FindingOrganization;
  readonly zone: string;
  readonly issuedMs: number;
  readonly stale: boolean;
  readonly mean: { readonly value: number; readonly hours: number } | undefined;
};

const pairKey = (assetId: string, pointKey: string): string => `${assetId}\u0000${pointKey}`;

function pointsOf(input: ForecastFindingsInput, currentHourMs: number): Point[] {
  const means = new Map(input.means.map((m) => [pairKey(m.asset_id, m.point_key), m]));
  const byPair = new Map<string, { first: ForecastFindingDbRow; rows: ForecastFindingDbRow[] }>();
  for (const row of input.rows) {
    const key = pairKey(row.asset_id, row.point_key);
    const entry = byPair.get(key);
    if (entry) entry.rows.push(row);
    else byPair.set(key, { first: row, rows: [row] });
  }
  const end = currentHourMs + 48 * 3_600_000;
  return [...byPair.entries()].map(([key, { first, rows }]) => {
    const mean = means.get(key);
    return {
      assetId: first.asset_id,
      pointKey: first.point_key,
      unit: first.unit,
      code: first.asset_code,
      label: assetLabel({ code: first.asset_code, rtuName: first.asset_rtu_name, locationName: first.location_name }),
      organization: organizationOf(first),
      zone: resolveSiteTimeZone(first.location_time_zone, first.organization_time_zone).arithmeticZone,
      issuedMs: first.issued_ms,
      stale: isStale(first.first_bucket_ms, currentHourMs),
      mean:
        mean !== undefined && mean.mean_24h !== null ? { value: Number(mean.mean_24h), hours: Number(mean.hours) } : undefined,
      buckets: rows
        .filter((r) => r.bucket_ms >= currentHourMs && r.bucket_ms < end)
        .sort((a, b) => a.bucket_ms - b.bucket_ms)
        .map((r) => ({ ms: r.bucket_ms, p10: r.p10, p50: r.p50, p90: r.p90 })),
    };
  });
}

type Pick = { readonly point: Point; readonly ms: number; readonly value: number };

/** The best bucket over `points` by `score` (larger wins); ties: the earlier hour, then the label. */
function best(points: readonly Point[], score: (b: Point["buckets"][number], p: Point) => number | null): Pick | null {
  let found: (Pick & { score: number }) | null = null;
  for (const point of points) {
    for (const bucket of point.buckets) {
      const s = score(bucket, point);
      if (s === null) continue;
      const better =
        found === null ||
        s > found.score ||
        (s === found.score && (bucket.ms < found.ms || (bucket.ms === found.ms && point.label < found.point.label)));
      if (better) found = { point, ms: bucket.ms, value: s, score: s };
    }
  }
  return found;
}

const at = (pick: Pick) => [asset(pick.point.assetId, pick.point.pointKey)];
const when = (pick: Pick) => time(formatFindingTime(pick.ms, pick.point.zone));

function f2(key: string, points: readonly Point[]): DraftLine | null {
  const low = best(points, (b) => -b.p50);
  const high = best(points, (b) => b.p50);
  if (low === null || high === null) return null;
  const words = tempWords(points[0]!.unit);
  return {
    id: "F2",
    parts: [
      text(`${key}: ${words.low} expected ${formatFindingValue(-low.value, low.point.unit)} at `),
      ...at(low),
      text(" ("),
      when(low),
      text(`); ${words.high} ${formatFindingValue(high.value, high.point.unit)} at `),
      ...at(high),
      text(" ("),
      when(high),
      text(")."),
    ],
  };
}

function f3(key: string, points: readonly Point[]): DraftLine | null {
  const eligible = points.filter((p) => p.mean !== undefined && p.mean.hours >= F3_MIN_ACTUAL_HOURS);
  const pick = best(eligible, (b, p) => Math.abs(b.p50 - p.mean!.value));
  if (pick === null) return null;
  const bucket = pick.point.buckets.find((b) => b.ms === pick.ms)!;
  const change = bucket.p50 - pick.point.mean!.value;
  return {
    id: "F3",
    parts: [
      text(`${key}: largest change from the last 24 h is ${formatSignedChange(change, pick.point.unit)} at `),
      ...at(pick),
      text(", at "),
      when(pick),
      text("."),
    ],
  };
}

function f4(key: string, points: readonly Point[]): DraftLine | null {
  const pick = best(points, (b) => b.p90 - b.p10);
  if (pick === null) return null;
  return {
    id: "F4",
    parts: [
      text(`${key}: least certain is `),
      ...at(pick),
      text(`, band ${formatFindingValue(pick.value, pick.point.unit)} wide at `),
      when(pick),
      text("."),
    ],
  };
}

function f5(crossing: Crossing): DraftLine {
  const point = crossing.point as Point;
  const head = [text("Advisory: "), asset(point.assetId, point.pointKey), text(` ${point.pointKey} `)];
  const limit = (verb: string) => [
    text(`${verb} the limit of rule `),
    rule(crossing.rule.name),
    text(` (${formatFindingValue(crossing.rule.threshold, point.unit)}) `),
  ];
  const t = time(formatFindingTime(crossing.bucketMs, point.zone));
  if (crossing.kind === "beyond") {
    return { id: "F5", parts: [...head, ...limit("is forecast beyond"), text("from now.")] };
  }
  if (crossing.kind === "expected") {
    return { id: "F5", parts: [...head, ...limit(`is expected to go ${crossing.direction}`), text("at "), t, text(".")] };
  }
  return {
    id: "F5",
    parts: [...head, ...limit(`may go ${crossing.direction}`), text("at "), t, text(` (${crossing.band} band).`)],
  };
}

const toCrossingRule = (r: ThresholdRuleDbRow): CrossingRule => ({
  ruleId: r.rule_id,
  assetId: r.asset_id,
  pointKey: r.point_key,
  name: r.rule_name,
  operator: r.operator,
  threshold: r.threshold_value === null ? null : Number(r.threshold_value),
  ruleType: r.rule_type,
  window: r.rule_window,
  unit: r.rule_unit,
});

function cardFor(organization: FindingOrganization, points: readonly Point[], rules: readonly CrossingRule[], narrowed: boolean): FindingsCardFacts {
  const names = new Map(points.map((p): [string, AssetName] => [p.assetId, { code: p.code, label: p.label }]));
  const finish = (lines: DraftLine[]) =>
    finishCard(organization, lines, (id) => names.get(id) ?? unknownAsset(id), (id, keys) => forecastFindingHref(id, keys));
  if (points.length === 0) {
    const sentence = narrowed ? "No forecast points in this selection." : "No forecast points for this organization.";
    return finish([{ id: "F_NONE", parts: [text(sentence)] }]);
  }
  const newest = points.reduce((a, b) => (b.issuedMs > a.issuedMs ? b : a));
  const n = points.length;
  const line1: DraftLine = {
    id: "F1",
    parts: [
      text(`${n} forecast ${n === 1 ? "point" : "points"}, issued at `),
      time(formatFindingTime(newest.issuedMs, newest.zone)),
      text(`; ${points.filter((p) => p.stale).length} stale.`),
    ],
  };
  const byKey = new Map<string, Point[]>();
  for (const p of points) byKey.set(p.pointKey, [...(byKey.get(p.pointKey) ?? []), p]);
  const keys = [...byKey.keys()].sort((a, b) => byKey.get(b)!.length - byKey.get(a)!.length || (a < b ? -1 : a > b ? 1 : 0));
  const used = keys.slice(0, MAX_KEYS);
  const per = (build: (key: string, pts: readonly Point[]) => DraftLine | null) =>
    used.map((key) => build(key, byKey.get(key)!)).filter((line): line is DraftLine => line !== null);
  const lines2 = per(f2);
  const lines3 = per(f3);
  const lines4 = per(f4);
  const lines5 = crossingsOf(points, rules).map(f5);
  const more: DraftLine[] =
    keys.length > MAX_KEYS ? [{ id: "F_MORE", parts: [text(`and ${keys.length - MAX_KEYS} more point ${keys.length - MAX_KEYS === 1 ? "type" : "types"}.`)] }] : [];

  // R-h: F1 and F_MORE keep their places; the rest fill in F5, F2, F3, F4 order.
  let room = MAX_LINES - 1 - more.length;
  const take = (lines: DraftLine[]): DraftLine[] => {
    const kept = lines.slice(0, Math.max(room, 0));
    room -= kept.length;
    return kept;
  };
  const kept5 = take(lines5);
  const kept2 = take(lines2);
  const kept3 = take(lines3);
  const kept4 = take(lines4);
  return finish([line1, ...kept2, ...kept3, ...kept4, ...kept5, ...more]);
}

/** One card per organization, by organization code (decision 2, Q1(a)). */
export function buildForecastCards(input: ForecastFindingsInput, now: Date): FindingsCardFacts[] {
  const points = pointsOf(input, currentHourOf(now)).filter((p) => p.buckets.length > 0);
  const rules = input.rules.map(toCrossingRule);
  const organizations = new Map<string, FindingOrganization>();
  for (const p of points) organizations.set(p.organization.organizationId, p.organization);
  for (const row of input.organizations) {
    if (!organizations.has(row.organization_id)) organizations.set(row.organization_id, organizationOf(row));
  }
  return byOrganizationCode(
    [...organizations.values()].map((org) =>
      cardFor(
        org,
        points.filter((p) => p.organization.organizationId === org.organizationId),
        rules,
        input.narrowed,
      ),
    ),
  );
}
