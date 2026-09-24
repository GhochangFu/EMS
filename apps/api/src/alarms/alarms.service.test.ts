import { describe, it } from "vitest";

import {
  assertAFractionalLimitReachesSqlAsAnInteger,
  assertAnInfiniteLimitClampsToOneHundred,
  assertASubOneFractionalLimitClampsToOne,
} from "./alarms.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("alarms.service — the GET /alarms limit clamp (F3.28, plan decision 4)", () => {
  it("passes a fractional limit to SQL as an integer", async () => {
    await assertAFractionalLimitReachesSqlAsAnInteger();
  });

  it("clamps an infinite limit to 100", async () => {
    await assertAnInfiniteLimitClampsToOneHundred();
  });

  it("clamps a sub-one fractional limit to 1", async () => {
    await assertASubOneFractionalLimitClampsToOne();
  });
});
