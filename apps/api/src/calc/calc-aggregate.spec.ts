import type { CalcExpr } from "@bms/shared";
import { CALC_DIALECT_V2, crossRefKey, evaluate, parseFormula } from "@bms/shared";

import { resolveAggregate } from "./calc-aggregate";
import type { CalcInputSample } from "./calc-inputs";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const NOW_MS = 1_000_000;
const MAX_AGE_SECONDS = 60;

/** A sample `ageSeconds` old at `NOW_MS`. */
function sample(value: number, ageSeconds = 0): CalcInputSample {
  return { value, timeMs: NOW_MS - ageSeconds * 1000 };
}

const FRESH_10 = sample(10);
const FRESH_20 = sample(20);
const STALE_30 = sample(30, MAX_AGE_SECONDS + 1);

/**
 * ADR 0055 decision 11, the four rules, each with exact numbers. The reasons
 * are decision 9's existing vocabulary (`missing_input` / `stale_input`)
 * plus the two the ADR adds (`no_members` / `coverage_below_floor`) — never a
 * merged or a new one.
 */
export function runResolveAggregateTests(): void {
  // ---- rule 1: zero declared members ----------------------------------------------

  const empty = resolveAggregate("sum", [], NOW_MS, MAX_AGE_SECONDS, null);
  assert(!empty.ok && empty.reason === "no_members", `zero declared members must be no_members, got ${JSON.stringify(empty)}`);
  const emptyWithRatio = resolveAggregate("avg", [], NOW_MS, MAX_AGE_SECONDS, 0.5);
  assert(
    !emptyWithRatio.ok && emptyWithRatio.reason === "no_members",
    `zero declared members is no_members whatever the ratio — never a coverage arithmetic over 0/0, got ${JSON.stringify(emptyWithRatio)}`,
  );

  // ---- rule 2: a null ratio fails closed on the first non-fresh member -------------

  const oneStale = resolveAggregate("sum", [FRESH_10, STALE_30, FRESH_20], NOW_MS, MAX_AGE_SECONDS, null);
  assert(
    !oneStale.ok && oneStale.reason === "stale_input",
    `ratio null with one stale member must refuse as stale_input, got ${JSON.stringify(oneStale)}`,
  );
  const oneMissing = resolveAggregate("sum", [FRESH_10, undefined, FRESH_20], NOW_MS, MAX_AGE_SECONDS, null);
  assert(
    !oneMissing.ok && oneMissing.reason === "missing_input",
    `ratio null with one member that never reported must refuse as missing_input, got ${JSON.stringify(oneMissing)}`,
  );
  // The **first** excluded member names the reason — declared order, not severity.
  const missingThenStale = resolveAggregate("sum", [STALE_30, undefined], NOW_MS, MAX_AGE_SECONDS, null);
  assert(
    !missingThenStale.ok && missingThenStale.reason === "stale_input",
    `the first excluded member in declared order names the reason, got ${JSON.stringify(missingThenStale)}`,
  );
  const allFresh = resolveAggregate("sum", [FRESH_10, FRESH_20], NOW_MS, MAX_AGE_SECONDS, null);
  assert(
    allFresh.ok && allFresh.value === 30 && allFresh.excluded === 0,
    `ratio null with every member fresh sums them all, excluded 0, got ${JSON.stringify(allFresh)}`,
  );

  // ---- rule 3: a ratio set compares fresh / declared against it -------------------

  const threeDeclaredTwoFresh = [FRESH_10, FRESH_20, STALE_30];
  const atSixty = resolveAggregate("sum", threeDeclaredTwoFresh, NOW_MS, MAX_AGE_SECONDS, 0.6);
  assert(
    atSixty.ok && atSixty.value === 30 && atSixty.excluded === 1,
    `3 declared, 2 fresh, ratio 0.6 → ok over the fresh members (10 + 20), excluded 1, got ${JSON.stringify(atSixty)}`,
  );
  const atSeventy = resolveAggregate("sum", threeDeclaredTwoFresh, NOW_MS, MAX_AGE_SECONDS, 0.7);
  assert(
    !atSeventy.ok && atSeventy.reason === "coverage_below_floor",
    `3 declared, 2 fresh, ratio 0.7 → 0.667 < 0.7 is coverage_below_floor, got ${JSON.stringify(atSeventy)}`,
  );
  // The floor is inclusive: exactly at the ratio passes.
  const exactlyAtFloor = resolveAggregate("sum", [FRESH_10, STALE_30], NOW_MS, MAX_AGE_SECONDS, 0.5);
  assert(
    exactlyAtFloor.ok && exactlyAtFloor.value === 10 && exactlyAtFloor.excluded === 1,
    `2 declared, 1 fresh, ratio 0.5 → exactly at the floor is ok, got ${JSON.stringify(exactlyAtFloor)}`,
  );
  // A missing member counts against coverage exactly like a stale one.
  const missingCountsAgainst = resolveAggregate("sum", [FRESH_10, undefined, undefined], NOW_MS, MAX_AGE_SECONDS, 0.5);
  assert(
    !missingCountsAgainst.ok && missingCountsAgainst.reason === "coverage_below_floor",
    `3 declared, 1 fresh (two missing), ratio 0.5 → coverage_below_floor, got ${JSON.stringify(missingCountsAgainst)}`,
  );
  // Ratio 1 with every member fresh is the "every member" case and must pass —
  // a strict comparison at 1 would silently disable it.
  const everyMemberAtOne = resolveAggregate("sum", [FRESH_10, FRESH_20], NOW_MS, MAX_AGE_SECONDS, 1);
  assert(
    everyMemberAtOne.ok && everyMemberAtOne.value === 30,
    `ratio 1 with every member fresh must be ok, got ${JSON.stringify(everyMemberAtOne)}`,
  );
  const everyMemberAtOneShort = resolveAggregate("sum", [FRESH_10, STALE_30], NOW_MS, MAX_AGE_SECONDS, 1);
  assert(
    !everyMemberAtOneShort.ok && everyMemberAtOneShort.reason === "coverage_below_floor",
    `ratio 1 with one stale member is coverage_below_floor — not stale_input, which is the null-ratio reason, got ${JSON.stringify(everyMemberAtOneShort)}`,
  );
  // No fresh member at all is never a computed 0, whatever the ratio.
  const noneFresh = resolveAggregate("sum", [STALE_30, undefined], NOW_MS, MAX_AGE_SECONDS, 0.1);
  assert(
    !noneFresh.ok && noneFresh.reason === "coverage_below_floor",
    `zero fresh members must refuse, never sum to 0, got ${JSON.stringify(noneFresh)}`,
  );

  // ---- avg, and the boundary of classifyInput is the same one -------------------

  const average = resolveAggregate("avg", [sample(2), sample(4)], NOW_MS, MAX_AGE_SECONDS, null);
  assert(average.ok && average.value === 3, `avg over [2, 4] is 3, got ${JSON.stringify(average)}`);
  const averageOverFresh = resolveAggregate("avg", [sample(2), sample(4), STALE_30], NOW_MS, MAX_AGE_SECONDS, 0.5);
  assert(
    averageOverFresh.ok && averageOverFresh.value === 3 && averageOverFresh.excluded === 1,
    `avg divides by the fresh count, not the declared count, got ${JSON.stringify(averageOverFresh)}`,
  );
  const atTheEdge = resolveAggregate("sum", [sample(5, MAX_AGE_SECONDS)], NOW_MS, MAX_AGE_SECONDS, null);
  assert(
    atTheEdge.ok && atTheEdge.value === 5,
    `a member exactly at the age budget is fresh — classifyInput's inclusive edge, unchanged, got ${JSON.stringify(atTheEdge)}`,
  );

  // ---- rule 4 is structural: a derived member is a sample like any other ----------
  // There is no member type to branch on — the function takes samples, and a
  // derived point's sample is classified by the same `classifyInput`. The
  // sweep-level proof (a member computed this tick, read from the overlay and
  // aged by its bucketed timestamp) is in `calc-scheduler.spec.ts`.

  // ---- -0 normalises through evaluate, not here ------------------------------------

  const negativeZero = resolveAggregate("sum", [sample(-0)], NOW_MS, MAX_AGE_SECONDS, null);
  assert(negativeZero.ok && Object.is(negativeZero.value, -0), "the aggregate passes -0 through untouched");
  const parsed = parseFormula("sum({kw} @site)", { dialect: CALC_DIALECT_V2 });
  assert(parsed.ok, "the fixture formula must parse");
  if (parsed.ok && negativeZero.ok) {
    const node = parsed.ast as CalcExpr;
    const evaluated = evaluate(node, new Map(), new Map([[crossRefKey(parsed.crossRefs[0]), negativeZero.value]]));
    assert(
      evaluated.ok && Object.is(evaluated.value, 0),
      `evaluate normalises the aggregate's -0 to 0 (ADR 0037 decision 9), got ${JSON.stringify(evaluated)}`,
    );
  }
}
