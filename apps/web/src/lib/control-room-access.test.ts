import { describe, it } from "vitest";

import {
  runFalseForUndefinedOrEmptyTests,
  runFalseWhenNoRowCodeIsTrackedTests,
  runTrueWhenOneRowCodeIsTrackedTests,
} from "./control-room-access.spec";

/** Vitest entry point — see `apps/api/src/admin/admin.schema.test.ts` (ADR 0014). */
describe("hasAnyControlRoomAsset (F4.156)", () => {
  it("L1 is true when one row code is tracked", () => {
    runTrueWhenOneRowCodeIsTrackedTests();
  });

  it("L2 is false when no row code is tracked", () => {
    runFalseWhenNoRowCodeIsTrackedTests();
  });

  it("L3 is false for an undefined or empty list", () => {
    runFalseForUndefinedOrEmptyTests();
  });
});
