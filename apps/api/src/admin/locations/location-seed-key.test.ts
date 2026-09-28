import { describe, it } from "vitest";

import {
  createDropsTheSeedKey,
  createWithoutMetaStoresNull,
  updateDoesNotAddAKey,
  updateKeepsTheStoredKey,
  updateRefusesAnotherKey,
} from "./location-seed-key.spec";

describe("F4.170 ruling 20 — meta.seedKey is seed-owned", () => {
  it("K1 a create drops seedKey and keeps the other keys", () => {
    createDropsTheSeedKey();
  });
  it("K2 a create with no meta stores null", () => {
    createWithoutMetaStoresNull();
  });
  it("K3 an update that replaces meta keeps the stored key", () => {
    updateKeepsTheStoredKey();
  });
  it("K4 an update that sends another key keeps the stored one", () => {
    updateRefusesAnotherKey();
  });
  it("K5 an update that sends a key onto an unkeyed row stores none", () => {
    updateDoesNotAddAKey();
  });
});
