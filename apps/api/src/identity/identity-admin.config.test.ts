import { describe, it } from "vitest";

import {
  assertALookalikeHostIsRefused,
  assertATrailingSlashIsTrimmed,
  assertAValidConfigWarnsNothing,
  assertAnUnsetSecretWarnsByNameOnly,
  assertHttpsIsAccepted,
  assertLocalhostIsRefused,
  assertNullWhenTheRealmOrClientIdIsUnset,
  assertNullWhenTheSecretIsBlank,
  assertNullWhenTheSecretIsUnset,
  assertTheComposeServiceNameIsAccepted,
  assertTheConfigCarriesEveryValue,
  assertTheRefusalWarnsOnceNamingTheVariable,
  assertTheWarnCarriesNeitherTheUrlNorTheSecret,
} from "./identity-admin.config.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.78 U3 — buildIdentityAdminConfig (ADR 0089 decision 5)", () => {
  it("is null when the secret is unset", () => {
    assertNullWhenTheSecretIsUnset();
  });

  it("is null when the secret is blank", () => {
    assertNullWhenTheSecretIsBlank();
  });

  it("is null when the realm or the client id is unset", () => {
    assertNullWhenTheRealmOrClientIdIsUnset();
  });

  it("accepts http://keycloak:8080", () => {
    assertTheComposeServiceNameIsAccepted();
  });

  it("carries the realm, the client id and the secret", () => {
    assertTheConfigCarriesEveryValue();
  });

  it("refuses http://localhost:8080", () => {
    assertLocalhostIsRefused();
  });

  it("refuses a host that only starts with keycloak:8080", () => {
    assertALookalikeHostIsRefused();
  });

  it("accepts https://id.example", () => {
    assertHttpsIsAccepted();
  });

  it("trims a trailing slash from the base URL", () => {
    assertATrailingSlashIsTrimmed();
  });

  it("warns once, naming KEYCLOAK_ADMIN_URL, when the URL is refused", () => {
    assertTheRefusalWarnsOnceNamingTheVariable();
  });

  it("warns without the URL value or the secret", () => {
    assertTheWarnCarriesNeitherTheUrlNorTheSecret();
  });

  it("warns by name only when the secret is unset", () => {
    assertAnUnsetSecretWarnsByNameOnly();
  });

  it("warns nothing for a valid configuration", () => {
    assertAValidConfigWarnsNothing();
  });
});
