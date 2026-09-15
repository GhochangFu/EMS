import { describe, it } from "vitest";

import {
  assertBlankEndpointIsUnconfigured,
  assertExplicitRegionIsCarried,
  assertForcePathStyleFalseFlipsPathStyle,
  assertForcePathStyleTrueAndBlankReadTrue,
  assertHttpRefusalFiresBeforeMissingBucket,
  assertHttpWithAllowInsecureTrueIsAccepted,
  assertMinimalHttpsConfigParsesWithDefaults,
  assertNoRefusalEchoesTheEndpointOrSecret,
  assertRefusalRowThrowsItsOwnMessageAndNotTheNeighbours,
  assertSchemeRefusalDoesNotEchoTheEndpoint,
  assertStorageConfigErrorNameIsStable,
  assertUnsetEndpointIsUnconfigured,
  REFUSAL_ROWS,
} from "./storage-config.spec";

/**
 * F3.3 (ADR 0066 decisions 3, 8) — Vitest entry point for the object
 * storage configuration reader. Assertions live in the sibling `.spec`
 * (§4.6/ADR 0014); this file only runs them.
 */
describe("F3.3 — object storage configuration reader", () => {
  it("reads an unset OBJECT_STORAGE_ENDPOINT as unconfigured", () => {
    assertUnsetEndpointIsUnconfigured();
  });

  it("reads a whitespace-only OBJECT_STORAGE_ENDPOINT as unconfigured", () => {
    assertBlankEndpointIsUnconfigured();
  });

  it("parses a minimal https configuration with region us-east-1 and forcePathStyle true", () => {
    assertMinimalHttpsConfigParsesWithDefaults();
  });

  it("carries an explicit OBJECT_STORAGE_REGION", () => {
    assertExplicitRegionIsCarried();
  });

  it("flips path style off for OBJECT_STORAGE_FORCE_PATH_STYLE=false", () => {
    assertForcePathStyleFalseFlipsPathStyle();
  });

  it("reads OBJECT_STORAGE_FORCE_PATH_STYLE true or blank as path style on", () => {
    assertForcePathStyleTrueAndBlankReadTrue();
  });

  it("accepts an http endpoint when OBJECT_STORAGE_ALLOW_INSECURE is exactly true", () => {
    assertHttpWithAllowInsecureTrueIsAccepted();
  });

  it.each(REFUSAL_ROWS)(
    "refuses $label with its own guard's message and not the neighbours'",
    (row) => {
      assertRefusalRowThrowsItsOwnMessageAndNotTheNeighbours(row);
    },
  );

  it("refuses plain http before checking OBJECT_STORAGE_BUCKET", () => {
    assertHttpRefusalFiresBeforeMissingBucket();
  });

  it("never echoes the endpoint host, the access key or the secret in a refusal", () => {
    assertNoRefusalEchoesTheEndpointOrSecret();
  });

  it("does not echo the endpoint in the scheme refusal", () => {
    assertSchemeRefusalDoesNotEchoTheEndpoint();
  });

  it("gives StorageConfigError a stable name", () => {
    assertStorageConfigErrorNameIsStable();
  });
});
