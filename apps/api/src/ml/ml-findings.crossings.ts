import type { AutomationRuleOperator } from "@bms/shared";

import { compare } from "../rules/rule-evaluation";

/**
 * `E1.9a` / ADR 0135 Amendment 8 decision 3 (plan §4.2 F5) — when a point's
 * forecast is expected to cross its own alarm-rule threshold. Pure: no
 * database, no clock. **It raises nothing**: the answer is a sentence on a card.
 *
 * Covered: a published, enabled `threshold` rule on the forecast's own
 * `(asset, point)` with operator `gt`, `gte`, `lt` or `lte`, a threshold, and
 * `condition.window = "latest"`; a rule whose `condition.unit` is set and
 * differs from the point's unit is skipped. The read already holds the first
 * three (`ml-findings.reads.ts`); the rest are held here too, so a later read
 * cannot widen them. `compare` is the rule engine's own: no operator logic is
 * written twice.
 *
 * Per rule, over the 48 buckets in order: the first bucket whose p50 compares
 * true is *expected* (*beyond*, "from now", when it is bucket 0); else the first
 * whose band edge (p90 for `gt`/`gte`, p10 for `lt`/`lte`) compares true is
 * *may*; else nothing. Earliest first, then expected before may, then asset
 * label, then rule name; at most 3.
 */
export const MAX_CROSSINGS = 3;

const COVERED: ReadonlySet<string> = new Set<AutomationRuleOperator>(["gt", "gte", "lt", "lte"]);

export type CrossingBucket = { readonly ms: number; readonly p10: number; readonly p50: number; readonly p90: number };

/** One forecast point: its buckets from the current hour, ascending. */
export type CrossingPoint = {
  readonly assetId: string;
  readonly pointKey: string;
  readonly unit: string | null;
  readonly label: string;
  readonly buckets: readonly CrossingBucket[];
};

/** One rule as the read returns it; `window` and `unit` are the condition's. */
export type CrossingRule = {
  readonly ruleId: string;
  readonly assetId: string;
  readonly pointKey: string;
  readonly name: string;
  readonly operator: string;
  readonly threshold: number | null;
  readonly ruleType: string;
  readonly window: string | null;
  readonly unit: string | null;
};

export type Crossing = {
  readonly kind: "beyond" | "expected" | "may";
  readonly point: CrossingPoint;
  readonly rule: CrossingRule & { readonly operator: AutomationRuleOperator; readonly threshold: number };
  readonly bucketMs: number;
  /** `above` for `gt`/`gte`, `below` for `lt`/`lte`. */
  readonly direction: "above" | "below";
  /** The band edge a *may* crossing read: `upper` (p90) or `lower` (p10). */
  readonly band: "upper" | "lower";
};

/** Exported for E1.5a (degradation trends, ADR 0138). */
export const covers = (point: CrossingPoint, rule: CrossingRule): boolean =>
  rule.assetId === point.assetId &&
  rule.pointKey === point.pointKey &&
  rule.ruleType === "threshold" &&
  rule.window === "latest" &&
  COVERED.has(rule.operator) &&
  rule.threshold !== null &&
  Number.isFinite(rule.threshold) &&
  (rule.unit === null || rule.unit === point.unit);

function crossingOf(point: CrossingPoint, rule: Crossing["rule"]): Crossing | null {
  const upward = rule.operator === "gt" || rule.operator === "gte";
  const base = { point, rule, direction: upward ? "above" : "below", band: upward ? "upper" : "lower" } as const;
  const p50At = point.buckets.findIndex((b) => compare(b.p50, rule.operator, rule.threshold));
  if (p50At >= 0) {
    return { ...base, kind: p50At === 0 ? "beyond" : "expected", bucketMs: point.buckets[p50At]!.ms };
  }
  const edge = point.buckets.find((b) => compare(upward ? b.p90 : b.p10, rule.operator, rule.threshold));
  return edge === undefined ? null : { ...base, kind: "may", bucketMs: edge.ms };
}

const rank = (kind: Crossing["kind"]): number => (kind === "may" ? 1 : 0);

/** Every covered rule's first crossing, earliest first, at most {@link MAX_CROSSINGS}. */
export function crossingsOf(points: readonly CrossingPoint[], rules: readonly CrossingRule[]): Crossing[] {
  const found: Crossing[] = [];
  for (const point of points) {
    for (const rule of rules) {
      if (!covers(point, rule)) continue;
      const crossing = crossingOf(point, rule as Crossing["rule"]);
      if (crossing !== null) found.push(crossing);
    }
  }
  return found
    .sort(
      (a, b) =>
        a.bucketMs - b.bucketMs ||
        rank(a.kind) - rank(b.kind) ||
        a.point.label.localeCompare(b.point.label) ||
        a.rule.name.localeCompare(b.rule.name) ||
        a.rule.ruleId.localeCompare(b.rule.ruleId),
    )
    .slice(0, MAX_CROSSINGS);
}
