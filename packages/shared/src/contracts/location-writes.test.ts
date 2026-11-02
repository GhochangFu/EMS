import { describe, it } from "vitest";

import {
  FLOOR_AREA_REFUSALS,
  createAdmitsFt2,
  createAdmitsNullFloorArea,
  createDefaultsUnitToM2,
  createAdmitsNullProvince,
  createAdmitsParentId,
  createAdmitsPumpStationType,
  createRefusesNonUuidParentId,
  updateAdmitsNullCapital,
  ft2ConstantIsExact,
  refuses,
  squareMetresUnchanged,
  thousandSquareFeet,
  updateAdmitsFloorAreaAlone,
  updateAdmitsParentIdAlone,
} from "./location-writes.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E4.1b C1 — location body schemas admit null for province and capital", () => {
  it("updateLocationBodySchema admits capital: null", () => {
    updateAdmitsNullCapital();
  });

  it("createLocationBodySchema admits province: null", () => {
    createAdmitsNullProvince();
  });
});

describe("F4.157 — createLocationBodySchema.type widens off the closed enum (ADR 0077 D1)", () => {
  it("C5 — admits type: pump_station", () => {
    createAdmitsPumpStationType();
  });
});

describe("F2.10 — the location body schemas carry parentId (ADR 0098)", () => {
  it("P1 — create admits a uuid, null and absent", () => {
    createAdmitsParentId();
  });

  it("P2 — create refuses a non-uuid parentId", () => {
    createRefusesNonUuidParentId();
  });

  it("P3 — update admits { parentId: null } alone (the move)", () => {
    updateAdmitsParentIdAlone();
  });
});

describe("F4.304 — floorArea { value, unit } on the location write bodies (ADR 0108 Amendment 5 item 3)", () => {
  it("F1 — FT2_TO_M2 is exactly 0.09290304", () => {
    ft2ConstantIsExact();
  });
  it("F2 — 1000 ft2 is 92.90304 m2", () => {
    thousandSquareFeet();
  });
  it("F3 — 120 m2 stays 120", () => {
    squareMetresUnchanged();
  });
  it("F4 — create admits { value } and the parse carries unit m2", () => {
    createDefaultsUnitToM2();
  });
  it("F5 — create admits ft2", () => {
    createAdmitsFt2();
  });
  it("F6 — create admits null", () => {
    createAdmitsNullFloorArea();
  });
  it("F7 — update admits floorArea alone", () => {
    updateAdmitsFloorAreaAlone();
  });
  for (const which of ["create", "update"] as const) {
    for (const [label, bad, path] of FLOOR_AREA_REFUSALS) {
      it(`${which} refuses ${label} at ${path}`, () => {
        refuses(which, bad, path);
      });
    }
  }
});
