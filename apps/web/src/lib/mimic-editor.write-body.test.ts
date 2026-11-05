import { describe, it } from "vitest";

import {
  aRoleLessUnitSendsNoList,
  aUnitPointListRoundTrips,
  anAbsentFieldReadsAsTheStoreWritesIt,
  fromPresetListsNoPoints,
  layoutFromDtoKeepsTheList,
  theFixturesAreRouteBodies,
  theFlowBodyRoundTrips,
  theHtLtBodyRoundTrips,
  updateNodeDedupesAndClampsTheList,
  updateNodeIgnoresTheListOffARoledUnit,
  updateNodeStoresAUnitsList,
} from "./mimic-editor.write-body.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.87 PR 5 — editorLayoutFromWriteBody", () => {
  it("takes fixtures the route accepts", () => theFixturesAreRouteBodies());
  it("round-trips the F3.80 HT/LT body", () => theHtLtBodyRoundTrips());
  it("round-trips the F3.80 flow body", () => theFlowBodyRoundTrips());
  it("reads an absent field as the store writes it", () => anAbsentFieldReadsAsTheStoreWritesIt());
  it("F4.307 — round-trips a unit's point list", () => aUnitPointListRoundTrips());
  it("F4.307 — a role-less unit sends no list", () => aRoleLessUnitSendsNoList());
  it("F4.307 — update-node stores a roled unit's list", () => updateNodeStoresAUnitsList());
  it("F4.307 — update-node dedupes and clamps the list", () => updateNodeDedupesAndClampsTheList());
  it("F4.307 — a panel, a label and a role-less unit take no list", () => updateNodeIgnoresTheListOffARoledUnit());
  it("F4.307 — a started preset lists no points", () => fromPresetListsNoPoints());
  it("F4.307 — layoutFromDto keeps a unit's list", () => layoutFromDtoKeepsTheList());
});
