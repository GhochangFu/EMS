import { describe, it } from "vitest";

import {
  assertEveryCodeIsUniqueAndStartsWithNw,
  assertEveryCodeSitsAtTheControlRoomSite,
  assertEveryLayoutBodyParsesAsAPutBody,
  assertTheCatalogCarriesThemAfterTheWaterPlant,
  assertTheDomainsAreElectricalWaterAndHvac,
} from "./network-demo-seed.spec";

describe("F3.80 PR3 — the ND- demo assets", () => {
  it("gives every code once, starting with ND-", () => {
    assertEveryCodeIsUniqueAndStartsWithNw();
  });

  it("places every code at the control room site", () => {
    assertEveryCodeSitsAtTheControlRoomSite();
  });

  it("types the flow assets water and hvac and the rest electrical", () => {
    assertTheDomainsAreElectricalWaterAndHvac();
  });

  it("spreads them into the ESKOM catalog after the demo water plant", () => {
    assertTheCatalogCarriesThemAfterTheWaterPlant();
  });
});

describe("F4.263 — the ND- demo layouts", () => {
  it("writes two layouts the PUT body schema accepts", () => {
    assertEveryLayoutBodyParsesAsAPutBody();
  });
});
