import { describe, it } from "vitest";

import {
  runAChangeIsWrittenAndAudited,
  runAnUnchangedValueWritesNothing,
  runTheControllerRefusesABadBody,
  runTheGateRunsBeforeAnyRead,
} from "./organizations.poll-interval.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 — the organization default poll interval write (ADR 0141 decision 10, Amendment 1 (c))", () => {
  it("P1 — the gate runs before any read", async () => {
    await runTheGateRunsBeforeAnyRead();
  });
  it("P2 — an unchanged value writes nothing", async () => {
    await runAnUnchangedValueWritesNothing();
  });
  it("P3 — a change is written and audited { from, to } in the organization", async () => {
    await runAChangeIsWrittenAndAudited();
  });
  it("P4 — the controller refuses a bad body with 400", async () => {
    await runTheControllerRefusesABadBody();
  });
});
