import { describe, it } from "vitest";

import {
  assertASmuggledFieldIsRefusedAtUpsertSchedule,
  assertReportsDispatchQueueIsFleet,
  assertReportsDispatchQueueIsNamedReportsDispatch,
  assertReportsDispatchQueuePayloadIsAnEmptyStrictObject,
} from "./reports-dispatch.spec";

/**
 * F3.5b (ADR 0071 decision 8) — Vitest entry point for the
 * `reports-dispatch` declaration. Assertions live in the sibling `.spec`
 * (§4.6/ADR 0014); this file only runs them.
 */
describe("F3.5b — reports-dispatch declaration", () => {
  it("declares reports-dispatch as a fleet queue", () => {
    assertReportsDispatchQueueIsFleet();
  });

  it("names the queue reports-dispatch", () => {
    assertReportsDispatchQueueIsNamedReportsDispatch();
  });

  it("declares an empty strict payload", () => {
    assertReportsDispatchQueuePayloadIsAnEmptyStrictObject();
  });

  it("refuses a smuggled field at upsertSchedule", async () => {
    await assertASmuggledFieldIsRefusedAtUpsertSchedule();
  });
});
