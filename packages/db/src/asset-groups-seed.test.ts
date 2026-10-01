import { describe, it } from "vitest";

import {
  assertAnUndecidedCodeStaysNull,
  assertALeakSensorTakesLeakSensor,
  assertASmokeDetectorTakesSmokeDetector,
  assertEachDemoGroupCarriesItsDomain,
  assertTheGroupUpsertFillsOnlyANullDomain,
  assertThePheGatewayStaysUnroledInItsOwnDomain,
  assertTheSmocRolesFollowTheDomainThenTheCode,
  assertAWaterAssetJoinsTheWaterGroup,
  assertAWaterAssetTakesNoTrainRole,
  assertTheWaterGroupIsNamedWater,
  assertBothPumpShapesTakeOneRole,
  assertEskomReadingsAreUnchanged,
  assertEveryItAssetJoinsItRackAndItLoad,
  assertNoPheDeviceJoinsItLoad,
  assertAnElectricalReadingStaysInItsDomain,
  assertTheGatewayTakesNoRole,
  assertTheBackfillFillsOnlyANullLocation,
  assertTheRulingMapsEveryPheDevice,
  assertTheSeedRolesNoPheEnvironmentDevice,
} from "./asset-groups-seed.spec";

describe("F4.169/F4.170 addendum — ruling 10: the seed roles no PHE environment device", () => {
  it("gives none of the twelve PHE environment gateways a role", () => {
    assertTheSeedRolesNoPheEnvironmentDevice();
  });
});

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

  it("keeps an electrical reading out of every other domain", () => {
    assertAnElectricalReadingStaysInItsDomain();
  });

  it("leaves a code that decides nothing at NULL", () => {
    assertAnUndecidedCodeStaysNull();
  });
});

describe("F2.8 — demoGroupCodesForAsset files every IT asset under IT_LOAD as well", () => {
  it("gives an IT asset it-rack and IT_LOAD, and every other domain its one group", () => {
    assertEveryItAssetJoinsItRackAndItLoad();
  });

  it("gives no PHE device an IT_LOAD membership", () => {
    assertNoPheDeviceJoinsItLoad();
  });
});

describe("E4.3 U11 — demoGroupCodesForAsset files a water asset under water", () => {
  it("gives WTR-WTP-01 the water group alone", () => {
    assertAWaterAssetJoinsTheWaterGroup();
  });

  it("names the water group Water", () => {
    assertTheWaterGroupIsNamedWater();
  });

  it("gives a water asset no train role", () => {
    assertAWaterAssetTakesNoTrainRole();
  });
});

describe("F3.73 D12 — demoRoleForAsset gives the SMOC roles", () => {
  it("roles UPS, battery, HVAC, IT and environment assets by domain, then by code", () => {
    assertTheSmocRolesFollowTheDomainThenTheCode();
  });

  it("gives a leak sensor leak-sensor", () => {
    assertALeakSensorTakesLeakSensor();
  });

  it("gives a smoke detector smoke-detector", () => {
    assertASmokeDetectorTakesSmokeDetector();
  });

  it("leaves the PHE gateway unroled in its own environment domain", () => {
    assertThePheGatewayStaysUnroledInItsOwnDomain();
  });
});

describe("F3.73 D12 — seedAssetGroups writes each group's domain", () => {
  it("maps every demo group code to its domain, and IT_LOAD to none", () => {
    assertEachDemoGroupCarriesItsDomain();
  });

  it("fills a NULL domain from a live asset_domains code and never overwrites one", () => {
    assertTheGroupUpsertFillsOnlyANullDomain();
  });
});

describe("F4.169/F4.170 addendum 2 — ruling 14: the location backfill fills only a NULL location_id", () => {
  it("matches a NULL location_id, never another location, and keeps the oldest-name order", () => {
    assertTheBackfillFillsOnlyANullLocation();
  });
});
