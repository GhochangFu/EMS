import { describe, it } from "vitest";

import {
  runA1LocationScopeGrantsEveryAreaTests,
  runA2ElectricalOnlyGrantsUpsBatteryNotHvacTests,
  runA3NoneScopeDeniesOverviewTests,
  runA4NullScopeGrantsOverviewDeniesHvacTests,
} from "./control-room-access.spec";

/** Vitest entry point — see `apps/api/src/admin/admin.schema.test.ts` (ADR 0014). */
describe("canAccessControlRoomArea (U5b)", () => {
  it("A1 a location scope grants every area", () => {
    runA1LocationScopeGrantsEveryAreaTests();
  });

  it("A2 an electrical-only asset_group scope grants upsBattery but not hvac", () => {
    runA2ElectricalOnlyGrantsUpsBatteryNotHvacTests();
  });

  it("A3 a none scope denies overview", () => {
    runA3NoneScopeDeniesOverviewTests();
  });

  it("A4 a null scope grants overview but denies hvac", () => {
    runA4NullScopeGrantsOverviewDeniesHvacTests();
  });
});
