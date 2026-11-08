import { describe, it } from "vitest";

import { assertThe300sDeadlineFiresAt315Seconds } from "./discovery-listener.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("the discovery listener's hard deadline (F4.339, plan R5)", () => {
  it("ends a 300 s window with no SUBACK at 315 s, not before", async () => {
    await assertThe300sDeadlineFiresAt315Seconds();
  });
});
