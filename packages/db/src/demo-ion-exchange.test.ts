import { describe, it } from "vitest";

import {
  assertIonxIsNotASeedOrganization,
  assertAFullReadBackHasNoShortfall,
  assertAMissingRoledMemberIsNamed,
  assertAnExtraGrantIsAShortfall,
  assertAnExtraWidgetIsNotAShortfall,
  assertEachCodeKeepsTheSimulatorWaterShape,
  assertFewerWidgetsThanTheFloorIsAShortfall,
  assertIonxAssetCodeForRefusesAnUnexpectedSuffix,
  assertNoIonxCodeCollidesWithTheEskomDemoPlant,
  assertRoleMapIsTheRuledOne,
  assertTheWidgetConfigIsTheWaterTrainPreset,
  assertTheCommandResizesItsOwnDashboardsWidget,
  assertTheWidgetConfigParsesUnderMimicConfigSchema,
  assertTheIonxGroupIsAWaterDomainGroup,
} from "./demo-ion-exchange.spec";

describe("F3.32 / ADR 0079 Amendment 1 — the Ion Exchange demo command's pure parts", () => {
  it("IONX-DEMO is not a seed organization, so the F4.169 boot gate never counts it", () => {
    assertIonxIsNotASeedOrganization();
  });

  it("no IONX asset code collides with the ESKOM demo plant", () => {
    assertNoIonxCodeCollidesWithTheEskomDemoPlant();
  });

  it("each code keeps the WTR-<CLASS>-NN simulator shape", () => {
    assertEachCodeKeepsTheSimulatorWaterShape();
  });

  it("ionxAssetCodeFor refuses a code that does not end in -01", () => {
    assertIonxAssetCodeForRefusesAnUnexpectedSuffix();
  });

  it("the role map is the ruled one", () => {
    assertRoleMapIsTheRuledOne();
  });

  it("the widget config parses under mimicConfigSchema", () => {
    assertTheWidgetConfigParsesUnderMimicConfigSchema();
  });

  it("the widget config is the water_train preset", () => {
    assertTheWidgetConfigIsTheWaterTrainPreset();
  });

  it("a full read-back has no shortfall", () => {
    assertAFullReadBackHasNoShortfall();
  });

  it("a missing roled member is named with its counts", () => {
    assertAMissingRoledMemberIsNamed();
  });

  it("an extra grant is a shortfall", () => {
    assertAnExtraGrantIsAShortfall();
  });

  it("an extra widget is not a shortfall (widgets is a floor)", () => {
    assertAnExtraWidgetIsNotAShortfall();
  });

  it("fewer widgets than the floor is still a shortfall", () => {
    assertFewerWidgetsThanTheFloorIsAShortfall();
  });

  it("F3.32b the command resizes its own dashboard's 12 x 6 mimic widget", async () => {
    await assertTheCommandResizesItsOwnDashboardsWidget();
  });
});

describe("F3.73 D12 — the IONX demo group carries the water domain", () => {
  it("writes domain water and gives an existing row one only while it has none", () => {
    assertTheIonxGroupIsAWaterDomainGroup();
  });
});
