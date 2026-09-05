import type { CalcAggregateFn } from "@bms/shared";

import { classifyInput, type CalcInputSample } from "./calc-inputs";

/**
 * Why one aggregate produced no value (ADR 0055 decision 11). `missing_input`
 * and `stale_input` are decision 9's existing vocabulary, unchanged — a
 * member is an input like any other; `no_members` and `coverage_below_floor`
 * are the two decision 11 adds. Every member is a `CalcRuntimeSkipReason`.
 */
export type AggregateSkipReason = "no_members" | "missing_input" | "stale_input" | "coverage_below_floor";

export type AggregateResult =
  | { ok: true; value: number; excluded: number }
  | { ok: false; reason: AggregateSkipReason };

/**
 * The value of one `sum(...)` / `avg(...)` over its declared members, or the
 * reason there is none (ADR 0055 decision 11; `F2.9` Task 13). Pure: no
 * clock, no database, no metrics — the host resolved the member set and read
 * the samples, and it counts whatever this returns.
 *
 * `members` is the **declared** member set in declared order, one entry per
 * member: the sample, or `undefined` for a member that never reported. A
 * member that is itself a derived point is a sample like any other — there is
 * nothing here to branch on, which is the ADR's "like any other" held by
 * construction rather than by a special case.
 *
 * The four rules, in order:
 *
 * 1. zero declared members → `no_members`, whatever the ratio;
 * 2. `minCoverageRatio === null` **fails closed**: every declared member must
 *    be fresh, and the first that is not — in declared order — names the
 *    reason through its own `classifyInput` result;
 * 3. a ratio set: `fresh / declared < ratio` → `coverage_below_floor`;
 *    otherwise the value over the **fresh** members only, with
 *    `excluded = declared - fresh`. The comparison is `<`, so exactly at the
 *    ratio passes, and `1` means "every member" exactly as `null` does — with
 *    `coverage_below_floor` as the reason instead of the member's own;
 * 4. a derived member is classified by the same `classifyInput` (above).
 *
 * Zero fresh members is refused under rule 3 for every legal ratio (the bound
 * is `(0, 1]`, re-checked at read time by `toActiveDefinition` as
 * `coverage_ratio_out_of_range`). The explicit check below is for a ratio
 * outside that bound reaching here anyway: a sum over nothing is a silently
 * computed `0`, which is the failure class this whole rule exists to prevent,
 * and this function's contract must not assume its caller.
 *
 * `-0` is passed through untouched — `evaluate` normalises every value it
 * returns (ADR 0037 decision 9), and this function is not a second evaluator.
 */
export function resolveAggregate(
  fn: CalcAggregateFn,
  members: readonly (CalcInputSample | undefined)[],
  nowMs: number,
  maxInputAgeSeconds: number,
  minCoverageRatio: number | null,
): AggregateResult {
  if (members.length === 0) {
    return { ok: false, reason: "no_members" };
  }

  const fresh: number[] = [];
  for (const member of members) {
    const classification = classifyInput(member, nowMs, maxInputAgeSeconds);
    if (classification === "fresh" && member) {
      fresh.push(member.value);
      continue;
    }
    if (minCoverageRatio === null) {
      return { ok: false, reason: classification === "missing" ? "missing_input" : "stale_input" };
    }
  }

  if (minCoverageRatio !== null && fresh.length / members.length < minCoverageRatio) {
    return { ok: false, reason: "coverage_below_floor" };
  }
  if (fresh.length === 0) {
    return { ok: false, reason: "coverage_below_floor" };
  }

  // No seed value: `0 + -0` is `+0`, and normalising is `evaluate`'s job, not
  // this function's. `fresh` is non-empty here, so the seedless form is total.
  const sum = fresh.reduce((total, value) => total + value);
  return {
    ok: true,
    value: fn === "avg" ? sum / fresh.length : sum,
    excluded: members.length - fresh.length,
  };
}
