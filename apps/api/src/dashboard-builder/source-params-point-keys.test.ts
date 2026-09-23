import { describe, it } from "vitest";

import {
  balanceRolesAreDeduplicated,
  oldEntriesYieldNoBalanceRole,
  oldEntriesYieldNothing,
  sourceWithoutABalanceRoleYieldsNothing,
  sustainabilitySourceYieldsItsBalanceRole,
  pointKeysAreDeduplicated,
  sustainabilitySourceYieldsItsPointKey,
  unknownCatalogKeyYieldsNothing,
  unparseableParamsYieldNothing,
} from "./source-params-point-keys.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E4.2 U3 — sourceParamsPointKeys", () => {
  it("yields nothing for the five Stage C entries", () => {
    oldEntriesYieldNothing();
  });

  it("yields a sustainability binding's pointKey", () => {
    sustainabilitySourceYieldsItsPointKey();
  });

  it("yields nothing for params the write schema refuses", () => {
    unparseableParamsYieldNothing();
  });

  it("de-duplicates a key bound on more than one widget", () => {
    pointKeysAreDeduplicated();
  });

  it("yields nothing for a catalog key outside the vocabulary, without throwing", () => {
    unknownCatalogKeyYieldsNothing();
  });
});

/** `E4.3` / ADR 0073 decision 2 — Vitest entry point for the balance-role lift. */
describe("E4.3 — sourceParamsBalanceRoles", () => {
  it("yields no role for the five Stage C entries", () => {
    oldEntriesYieldNoBalanceRole();
  });

  it("yields a sustainability binding's balanceRole", () => {
    sustainabilitySourceYieldsItsBalanceRole();
  });

  it("yields nothing for a binding without balanceRole", () => {
    sourceWithoutABalanceRoleYieldsNothing();
  });

  it("de-duplicates a role bound on more than one widget", () => {
    balanceRolesAreDeduplicated();
  });
});
