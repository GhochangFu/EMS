import { describe, it } from "vitest";

import {
  aBadProtocolOrAdapterConfigIsReportedByPath,
  aDeviceKeyListedTwiceIsRefused,
  aGoodFileParses,
  aMalformedTokenIsRefusedUnprinted,
  anHttpOrCredentialedUplinkUrlIsRefused,
  credentialsAreNamesOnly,
  eachRequiredVariableIsNamed,
  mqttDevicesNeedSourceKeysAndInlineFormats,
  plainMqttOnlyForAnAllowListedHost,
  rejectUnauthorizedIsRefused,
  relativePathsAreRefused,
  theBufferBoundsDefaultAndTheAgeHasACeiling,
  theEdgeNeedsNoDatabase,
  theReplayRateHasAFloor,
} from "./edge-config.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E7.2 — the edge environment (ADR 0123 decisions 5 and 7, plan T5.1)", () => {
  it("names each required variable", () => {
    eachRequiredVariableIsNamed();
  });

  it("refuses an http:// or credentialed uplink URL without echoing it", () => {
    anHttpOrCredentialedUplinkUrlIsRefused();
  });

  it("refuses a malformed gateway token without printing it", () => {
    aMalformedTokenIsRefusedUnprinted();
  });

  it("defaults the buffer bounds and caps the age at 6 d", () => {
    theBufferBoundsDefaultAndTheAgeHasACeiling();
  });

  it("refuses relative paths", () => {
    relativePathsAreRefused();
  });

  it("holds the replay rate at or above 50/s", () => {
    theReplayRateHasAFloor();
  });

  it("needs no database", () => {
    theEdgeNeedsNoDatabase();
  });
});

describe("E7.2 — the edge configuration file (ADR 0123 decision 3, plan C11)", () => {
  it("parses a good file through the adapter's schemas", () => {
    aGoodFileParses();
  });

  it("names an unknown protocol and reports an adapter failure by path, never value", () => {
    aBadProtocolOrAdapterConfigIsReportedByPath();
  });

  it("refuses rejectUnauthorized", () => {
    rejectUnauthorizedIsRefused();
  });

  it("takes credentials as EDGE_CRED_ variable names only", () => {
    credentialsAreNamesOnly();
  });

  it("refuses a device key listed twice", () => {
    aDeviceKeyListedTwiceIsRefused();
  });

  it("allows plain MQTT only to an allow-listed host", () => {
    plainMqttOnlyForAnAllowListedHost();
  });

  it("needs MQTT sourceKeys and inline payload formats", () => {
    mqttDevicesNeedSourceKeysAndInlineFormats();
  });
});
