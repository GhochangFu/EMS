import { describe, it } from "vitest";

import {
  assertAnUndecidedCodeStaysNull,
  assertEveryNetworkDemoCodeTakesNoRole,
  assertALeakSensorTakesLeakSensor,
  assertASmokeDetectorTakesSmokeDetector,
  assertEachDemoGroupCarriesItsDomain,
  assertEveryPheAssetJoinsThePumpStationGroup,
  assertTheGroupUpsertFillsOnlyANullDomain,
  assertThePheRtuUnitIsNotAnIndoorAirSensor,
  assertTheSmocRolesFollowTheDomainThenTheCode,
  assertAWaterAssetJoinsTheWaterGroup,
  assertAWaterAssetTakesNoTrainRole,
  assertTheWaterGroupIsNamedWater,
  assertEachPumpShapeTakesItsOwnRole,
  assertEskomReadingsAreUnchanged,
  assertEveryItAssetJoinsItRackAndItLoad,
  assertNoPheDeviceJoinsItLoad,
  assertAnElectricalReadingStaysInItsDomain,
  assertTheRtuUnitTakesRtuController,
  assertTheBackfillFillsOnlyANullLocation,
  assertTheRulingMapsEveryPheDevice,
  assertTheSeedRolesEveryPheEnvironmentDeviceRtuController,
} from "./asset-groups-seed.spec";

describe("F4.169/F4.170 addendum — ruling 10, F4.319: the seed roles every PHE environment device", () => {
  it("gives each of the twelve PHE RTU-health units rtu-controller", () => {
    assertTheSeedRolesEveryPheEnvironmentDeviceRtuController();
  });
});

describe("F3.41 / F4.319 — demoRoleForAsset carries the owner's PHE ruling (ADR 0113)", () => {
  it("maps PHE WB's 48 devices to 12 meter, 12 pump, 12 dosing-pump and 12 rtu-controller", () => {
    assertTheRulingMapsEveryPheDevice();
  });

  it("gives each pump shape its own role", () => {
    assertEachPumpShapeTakesItsOwnRole();
  });

  it("gives the AIRSP unit rtu-controller in its own domain only", () => {
    assertTheRtuUnitTakesRtuController();
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

  it("gives the PHE RTU-health unit rtu-controller, never indoor-air", () => {
    assertThePheRtuUnitIsNotAnIndoorAirSensor();
  });
});

describe("F4.319 — every PHE asset joins the pump-station group (ADR 0113 decision 6)", () => {
  it("files the 48 PHE devices under their domain group, then pump-station", () => {
    assertEveryPheAssetJoinsThePumpStationGroup();
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

describe("F3.80 Task 3.1 — the ND- demo assets stay out of the SMOC roles", () => {
  it("gives every NETWORK_DEMO_ASSETS code a null role from demoRoleForAsset", () => {
    assertEveryNetworkDemoCodeTakesNoRole();
  });
});
