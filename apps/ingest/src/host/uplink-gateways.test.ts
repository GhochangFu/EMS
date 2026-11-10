import { describe, it } from "vitest";

import {
  aNullHashNeverMatches,
  anUnknownStatusReadsAsRevoked,
  gatewayHealthCarriesNoHash,
  hashTokenIsSha256,
  loadGatewaysMapsRows,
  malformedTokenIs401,
  noHeaderIs401,
  organizationOffIs403,
  revokedIs403,
  theStoredHashIsNotACredential,
  twoGatewaysReturnTheRightOne,
  unknownTokenIs401,
  wrongSchemeIs401,
} from "./uplink-gateways.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E7.2 — uplink gateway authentication (ADR 0123 decision 5, plan T3.1)", () => {
  it("answers 401 with no Authorization header", () => {
    noHeaderIs401();
  });

  it("answers 401 for a scheme other than Bearer", () => {
    wrongSchemeIs401();
  });

  it("answers 401 for a malformed token", () => {
    malformedTokenIs401();
  });

  it("answers 401 for a token no gateway holds", () => {
    unknownTokenIs401();
  });

  it("never accepts the stored hash as a credential", () => {
    theStoredHashIsNotACredential();
  });

  it("answers 403 gateway-revoked for a revoked gateway", () => {
    revokedIs403();
  });

  it("answers 403 ingest-disabled for a switched-off organization (ADR 0115)", () => {
    organizationOffIs403();
  });

  it("never matches a NULL or wrong-length hash", () => {
    aNullHashNeverMatches();
  });

  it("returns the right gateway of two, in either order", () => {
    twoGatewaysReturnTheRightOne();
  });

  it("hashes the token with SHA-256", () => {
    hashTokenIsSha256();
  });

  it("maps the gateway query's rows", async () => {
    await loadGatewaysMapsRows();
  });

  it("reads an unknown status as revoked", async () => {
    await anUnknownStatusReadsAsRevoked();
  });

  it("builds a health view with no hash field", () => {
    gatewayHealthCarriesNoHash();
  });
});
