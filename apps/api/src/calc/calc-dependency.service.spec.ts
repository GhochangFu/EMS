import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import { CALC_DIALECT_V2 } from "@bms/shared";

import { MetricsService } from "../observability/metrics.service";
import type { TemplatePointCalcRow } from "./calc-definition";
import { CalcDefinitionsService } from "./calc-definitions.service";
import { CalcDependencyService } from "./calc-dependency.service";
import { CalcScopeService } from "./calc-scope.service";

/**
 * `F2.9` Task 12 — `CalcDependencyService`, the save-time cycle detector
 * (ADR 0055 decision 8).
 *
 * Two properties are held here rather than in an integration suite, because
 * neither is a question about SQL:
 *
 *  - **the detector's read does not move `bms_api_calc_skipped_total`** (plan
 *    correction 55, finding 30);
 *  - **a candidate replaces the stored definition for its own key** rather than
 *    being appended beside it.
 *
 * The database is a chainable stub: `reload()`'s builder returns a fixed row
 * set and `execute` returns the asset-code lookup. Nothing here asserts on the
 * query — `calc-definitions.integration.spec.ts` owns the resolution merge and
 * `calc-scope.integration.spec.ts` owns membership. What these need from the
 * database is only *some* rows, identically in both directions.
 */

const ASSET = "11111111-1111-4111-8111-111111111111";
const ASSET_CODE = "F29-DEP-A";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * A `template_points ⟕ asset_points` row as `reload()` projects it. Defaults
 * make a usable scheduled `bms-calc-v2` point; a case overrides the one column
 * it is about.
 */
function row(overrides: Partial<TemplatePointCalcRow>): TemplatePointCalcRow {
  return {
    templatePointId: `tp-${overrides.pointKey ?? "x"}`,
    assetId: ASSET,
    pointKey: "X",
    kind: "derived",
    formula: "{M}",
    formulaDialect: CALC_DIALECT_V2,
    calcTrigger: "scheduled",
    calcIntervalSeconds: 60,
    maxInputAgeSeconds: null,
    minCoverageRatio: null,
    ...overrides,
  };
}

/**
 * `reload()` awaits `select().from().innerJoin().leftJoin().where()`; the code
 * lookup goes through `execute`. Two disjoint surfaces, so one stub serves both
 * without either having to guess which call it is answering.
 */
function stubDb(rows: TemplatePointCalcRow[]): BmsDb {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "from", "innerJoin", "leftJoin"]) {
    chain[method] = () => chain;
  }
  chain.where = () => Promise.resolve(rows);
  chain.execute = () => Promise.resolve({ rows: [{ id: ASSET, code: ASSET_CODE }] });
  return chain as unknown as BmsDb;
}

/** A `CalcScopeService` over a database that throws if it is ever read — every
 * case here is local-reference only, so membership must resolve without a
 * query (`resolveMembership` returns early when no definition holds a cross
 * reference). A query here would mean the early return had been lost. */
function scopeOverNoDatabase(): CalcScopeService {
  const forbidden = {
    execute: () => {
      throw new Error("resolveMembership must not query when no definition holds a cross reference");
    },
  };
  return new CalcScopeService(forbidden as unknown as BmsDb);
}

/** A `MetricsService` whose calc skips are recorded instead of counted. */
function recordingMetrics(): { metrics: MetricsService; skips: string[] } {
  const skips: string[] = [];
  const metrics = new MetricsService();
  metrics.countCalcSkipped = (reason) => {
    skips.push(reason);
  };
  return { metrics, skips };
}

/**
 * Plan correction 55 / finding 30 — **the save-time read resolves without
 * counting.**
 *
 * `getAllDefinitionsFresh()` reloads past the 60s cache, and `reload()` counts
 * every unusable stored row through `MetricsService`. Left alone, a cycle check
 * on a template or override save would move `bms_api_calc_skipped_total` on an
 * author's keystroke. An operator reads that counter as "the engine refused to
 * compute N times"; if a save also moves it, the number means two things at
 * once and is readable as neither. ADR 0037 decision 9 requires that no
 * **evaluation** skip is silent — a validation read is not an evaluation.
 *
 * Both halves are asserted over the **same rows**, because "it did not count"
 * is also what reading nothing looks like:
 *
 *  - the detector's read leaves the counter untouched **and still finds the
 *    cycle**, which it can only do by having seen the stored definition;
 *  - a cache refresh over those same rows still counts the skip.
 *
 * Two service instances, not one: `ensureFresh` short-circuits inside the TTL,
 * so a second call on the same instance would count nothing for a reason that
 * has nothing to do with this rule.
 */
export async function assertTheDetectorsReadDoesNotCountSkips(): Promise<void> {
  const rows = [
    // Unusable — `no_formula`. This is the row whose skip must be counted by a
    // cache refresh and must not be counted by the detector.
    row({ pointKey: "BAD", templatePointId: "tp-bad", formula: null }),
    // Usable, and half of the cycle the candidate closes.
    row({ pointKey: "D", templatePointId: "tp-d", formula: "{E}" }),
  ];

  const detectorMetrics = recordingMetrics();
  const detectorDefs = new CalcDefinitionsService(stubDb(rows), detectorMetrics.metrics);
  const detector = new CalcDependencyService(stubDb(rows), detectorDefs, scopeOverNoDatabase());

  const members = await detector.checkCandidate({
    assetId: ASSET,
    pointKey: "E",
    templatePointId: "tp-e",
    dialect: CALC_DIALECT_V2,
    localRefs: ["D"],
    crossRefs: [],
  });

  assert(
    members.length === 2,
    "anti-vacuity: the detector must have read the stored definition and found the cycle, or " +
      `"it did not count" would just mean "it read nothing". Got ${JSON.stringify(members)}`,
  );
  expect(members.map((member) => member.pointKey).sort()).toEqual(["D", "E"]);
  expect(members.every((member) => member.assetCode === ASSET_CODE)).toBe(true);
  assert(
    !JSON.stringify(members).includes("{E}"),
    "a reported member carries an asset code and a point key, never formula text — a stored " +
      "formula is tenant content (ADR 0037's logging discipline)",
  );

  expect(
    detectorMetrics.skips,
    "a validation read is not an evaluation: checkCandidate must not move " +
      "bms_api_calc_skipped_total (plan correction 55)",
  ).toEqual([]);

  // The other half, over the same rows: an evaluation-path refresh still counts.
  const engineMetrics = recordingMetrics();
  const engineDefs = new CalcDefinitionsService(stubDb(rows), engineMetrics.metrics);
  await engineDefs.getScheduledDefinitions();
  expect(
    engineMetrics.skips,
    "the cache refresh the two evaluation hosts use must still count every skip — decision 9 " +
      "is untouched, and only the detector's read is exempt",
  ).toEqual(["no_formula"]);
}

/**
 * The candidate **replaces** the stored definition for its own
 * `(assetId, pointKey)`; it is not appended beside it.
 *
 * This matters because `buildCalcGraph` keeps the **first** node it sees for an
 * id and drops the rest — so an append-only implementation is silently a no-op:
 * the stored formula wins and the candidate is never checked at all. A test
 * asserting "no duplicate node" would pass under exactly that bug. So the
 * assertion is behavioural: the stored definition is cycle-free, the candidate
 * closes a loop, and the cycle must be reported.
 */
export async function assertTheCandidateReplacesItsOwnStoredNode(): Promise<void> {
  const rows = [
    // The stored TOTAL reads a measured key — no edge, no cycle.
    row({ pointKey: "TOTAL", templatePointId: "tp-total", formula: "{M}" }),
    row({ pointKey: "SUB", templatePointId: "tp-sub", formula: "{TOTAL}" }),
  ];
  const metrics = recordingMetrics();
  const defs = new CalcDefinitionsService(stubDb(rows), metrics.metrics);
  const detector = new CalcDependencyService(stubDb(rows), defs, scopeOverNoDatabase());

  const control = await detector.checkCandidate({
    assetId: ASSET,
    pointKey: "TOTAL",
    templatePointId: "tp-total",
    dialect: CALC_DIALECT_V2,
    localRefs: ["M"],
    crossRefs: [],
  });
  expect(control, "the stored estate is cycle-free, so the unchanged candidate reports nothing").toEqual([]);

  const members = await detector.checkCandidate({
    assetId: ASSET,
    pointKey: "TOTAL",
    templatePointId: "tp-total",
    dialect: CALC_DIALECT_V2,
    localRefs: ["SUB"],
    crossRefs: [],
  });
  assert(
    members.length === 2,
    "the candidate must displace the stored definition for its own key — appending it instead " +
      "leaves buildCalcGraph keeping the stored (cycle-free) node and the candidate unchecked. " +
      `Got ${JSON.stringify(members)}`,
  );
  expect(members.map((member) => member.pointKey).sort()).toEqual(["SUB", "TOTAL"]);
}

/** A candidate that lies on no cycle reports nothing, whatever else does. */
export async function assertACandidateOffEveryCycleReportsNothing(): Promise<void> {
  const rows = [
    row({ pointKey: "D", templatePointId: "tp-d", formula: "{E}" }),
    row({ pointKey: "E", templatePointId: "tp-e2", formula: "{D}" }),
  ];
  const metrics = recordingMetrics();
  const defs = new CalcDefinitionsService(stubDb(rows), metrics.metrics);
  const detector = new CalcDependencyService(stubDb(rows), defs, scopeOverNoDatabase());

  const members = await detector.checkCandidate({
    assetId: ASSET,
    pointKey: "FAR",
    templatePointId: "tp-far",
    dialect: CALC_DIALECT_V2,
    localRefs: ["D"],
    crossRefs: [],
  });
  expect(
    members,
    "plan design decision 7 and the Q6 ruling: only the cycle's own members are refused. A " +
      "formula that merely reads one is not on it, and must save.",
  ).toEqual([]);
}
