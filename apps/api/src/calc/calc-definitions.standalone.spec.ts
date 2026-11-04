import type { BmsDb } from "@bms/db";
import { CALC_DIALECT } from "@bms/shared";

import { MetricsService } from "../observability/metrics.service";
import { CalcDefinitionsService } from "./calc-definitions.service";

/**
 * `F4.311` PR 1 (ADR 0109 decision 2) — the loader's backstop for standalone
 * points, without a database.
 *
 * The standalone rows join `derivedPointKeysByAsset` **before** the
 * `referencesADerivedSiblingUnderV1` post-pass, so a `v1` standalone formula
 * that reads another standalone point on the same asset is the same
 * `v1_references_derived` skip a template point gets (ADR 0036 decision 7).
 * PR 2's write rules refuse such a formula at save time; this is the loader's
 * own backstop, and only this case reaches it.
 */

const ASSET = "00000000-0000-4000-8000-0000000000a1";

type StandaloneRow = {
  templatePointId: string;
  assetId: string;
  pointKey: string;
  formula: string | null;
  formulaDialect: string | null;
  calcTrigger: string | null;
  calcIntervalSeconds: number | null;
  maxInputAgeSeconds: number | null;
};

function standalone(pointKey: string, formula: string): StandaloneRow {
  return {
    templatePointId: `ap-${pointKey}`,
    assetId: ASSET,
    pointKey,
    formula,
    formulaDialect: CALC_DIALECT,
    calcTrigger: "scheduled",
    calcIntervalSeconds: 60,
    maxInputAgeSeconds: 300,
  };
}

/**
 * The template read is the only chain with a `leftJoin`; it answers with no
 * rows. The standalone read (no `leftJoin`) answers with `standaloneRows`.
 */
function stubDb(standaloneRows: StandaloneRow[]): BmsDb {
  const chain: Record<string, unknown> = {};
  let leftJoined = false;
  chain.select = () => {
    leftJoined = false;
    return chain;
  };
  for (const method of ["from", "innerJoin"]) {
    chain[method] = () => chain;
  }
  chain.leftJoin = () => {
    leftJoined = true;
    return chain;
  };
  chain.where = () => Promise.resolve(leftJoined ? [] : standaloneRows);
  return chain as unknown as BmsDb;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function loadTwoStandalonePoints(): Promise<{ keys: string[]; skips: string[] }> {
  const skips: string[] = [];
  const metrics = new MetricsService();
  metrics.countCalcSkipped = (reason) => {
    skips.push(reason);
  };
  // A reads B; B reads a measured key M. Both are standalone, both `v1`.
  const defs = await new CalcDefinitionsService(
    stubDb([standalone("A", "{B} + 1"), standalone("B", "{M} * 2")]),
    metrics,
  ).getScheduledDefinitions();
  return { keys: defs.map((def) => def.pointKey).sort(), skips };
}

export async function assertAV1StandaloneReadingAStandaloneSiblingIsRefused(): Promise<void> {
  const { keys } = await loadTwoStandalonePoints();
  assert(
    !keys.includes("A"),
    `a v1 standalone formula reading another standalone point must not load, got [${keys.join(", ")}]`,
  );
}

export async function assertTheSiblingItReadsStillLoads(): Promise<void> {
  const { keys } = await loadTwoStandalonePoints();
  assert(keys.includes("B"), `the standalone point over a measured key must load, got [${keys.join(", ")}]`);
}

export async function assertTheRefusalIsCountedAsV1ReferencesDerived(): Promise<void> {
  const { skips } = await loadTwoStandalonePoints();
  assert(
    skips.length === 1 && skips[0] === "v1_references_derived",
    `the refusal must be one counted v1_references_derived skip, got [${skips.join(", ")}]`,
  );
}
