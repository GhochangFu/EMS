import { describe, it } from "vitest";

import {
  createAdmitsNullProvince,
  createAdmitsParentId,
  createAdmitsPumpStationType,
  createMetaDescribesTheSeedKey,
  createRefusesNonUuidParentId,
  updateAdmitsNullCapital,
  updateAdmitsParentIdAlone,
  updateMetaDescribesTheSeedKey,
} from "./locations.schema.spec";

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

describe("F4.170 — the OpenAPI document says meta.seedKey is seed-owned (compliance review B1)", () => {
  it("D1 — the create body's meta description", () => {
    createMetaDescribesTheSeedKey();
  });

  it("D2 — the update body's meta description", () => {
    updateMetaDescribesTheSeedKey();
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
