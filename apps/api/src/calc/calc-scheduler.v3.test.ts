import { describe, it } from "vitest";

import {
  aDollarFreeV3MakesNoRead,
  failedReadRefusesOnlyParameterHolders,
  pairsAreTheDistinctSetOncePerSweep,
  parameterAbsentRefusesWithoutARow,
  parameterPresentWrites,
} from "./calc-scheduler.v3.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * Split from `calc-scheduler.test.ts` because its spec reached the §4.5
 * line cap; the harness (`buildSweepDeps`, `def`) is shared by import. */
describe("bms-calc-v3 in the scheduled sweep (ADR 0070)", () => {
  it("(i) the parameter present → one write with kw × f", async () => {
    await parameterPresentWrites();
  });

  it("(ii) the owed guard: the parameter absent → exactly one parameter_unset and no row; the v1 sibling still writes", async () => {
    await parameterAbsentRefusesWithoutARow();
  });

  it("(iii) a failed parameter read refuses only the definitions holding a $key, with one warn", async () => {
    await failedReadRefusesOnlyParameterHolders();
  });

  it("(iv) the pairs are the distinct (assetId, key) set, read once per sweep", async () => {
    await pairsAreTheDistinctSetOncePerSweep();
  });

  it("(v) a $-free v3 definition makes no parameter read", async () => {
    await aDollarFreeV3MakesNoRead();
  });
});
