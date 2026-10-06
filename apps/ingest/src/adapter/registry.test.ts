import { describe, it } from "vitest";

import {
  assertEveryWiredProtocolHasAnAdapterAndNoOtherDoes,
  assertTheCatalogAndTheFactoryAgreeOnDiscovery,
} from "./registry.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.24a — the adapter registry matches the protocol catalog (ADR 0093 decision 2)", () => {
  it("R1 serves every wired protocol and no other", () => {
    assertEveryWiredProtocolHasAnAdapterAndNoOtherDoes();
  });

  it("R2 agrees with the catalog on discovery", () => {
    assertTheCatalogAndTheFactoryAgreeOnDiscovery();
  });
});
