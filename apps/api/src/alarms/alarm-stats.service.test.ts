import { describe, it } from "vitest";

import { assertNoAssetIdsAnswerEmptyWithNoQuery } from "./alarm-stats.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.291 — AlarmStatsService without a database", () => {
  it("no asset ids answer the empty shape and use neither pool", assertNoAssetIdsAnswerEmptyWithNoQuery);
});
