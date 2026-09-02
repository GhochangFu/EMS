import { describe, it } from "vitest";

import {
  assertAnUndecidedCodeStaysNull,
  assertBothPumpShapesTakeOneRole,
  assertEskomReadingsAreUnchanged,
  assertOnlyElectricalAssetsTakeARole,
  assertTheGatewayTakesNoRole,
  assertTheRulingMapsEveryPheDevice,
} from "./asset-groups-seed.spec";

describe("F3.41 — demoRoleForAsset carries the owner's meter/pump ruling", () => {
  it("maps PHE WB's 48 devices to 12 meters, 24 pumps and 12 unroled gateways", () => {
    assertTheRulingMapsEveryPheDevice();
  });

  it("gives both pump shapes the one `pump` code", () => {
    assertBothPumpShapesTakeOneRole();
  });

  it("leaves the AIRSP gateway unroled, by code as well as by domain", () => {
    assertTheGatewayTakesNoRole();
  });

  it("changes no ESKOM reading", () => {
    assertEskomReadingsAreUnchanged();
  });

  it("gives a non-electrical asset no role, whatever its code says", () => {
    assertOnlyElectricalAssetsTakeARole();
  });

  it("leaves a code that decides nothing at NULL", () => {
    assertAnUndecidedCodeStaysNull();
  });
});
