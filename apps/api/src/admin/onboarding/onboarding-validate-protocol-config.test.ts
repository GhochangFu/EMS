import { describe, it } from "vitest";

import {
  assertAHeadTopicWildcardIsReportedOnce,
  assertAModbusRtuAcceptsAnyConfig,
  assertANestedDeviceWildcardIsReportedOnce,
  assertANumericPortHasNoConfigError,
  assertAnAbsentHostAndPortStillPass,
  assertASimulatorRtuAcceptsAnEmptyConfig,
  assertAStringPortIsReportedAtItsPath,
  assertRejectUnauthorizedIsRefused,
  assertTheCredentialsRequiredRowStays,
  assertTheOverLongTopicRowStays,
  assertTheTopicRequiredRowStays,
} from "./onboarding-validate-protocol-config.spec";

describe("validate — rtus[].config against the protocol's draft schema (F3.24a, ADR 0093)", () => {
  it("reports a string port at its path without echoing the value", () => assertAStringPortIsReportedAtItsPath());
  it("reports no config error for a numeric port", () => assertANumericPortHasNoConfigError());
  it("accepts an absent host and port", () => assertAnAbsentHostAndPortStillPass());
  it("reports a nested device wildcard once", () => assertANestedDeviceWildcardIsReportedOnce());
  it("reports a head-topic wildcard once", () => assertAHeadTopicWildcardIsReportedOnce());
  it("refuses rejectUnauthorized", () => assertRejectUnauthorizedIsRefused());
  it("accepts any config on modbus_tcp", () => assertAModbusRtuAcceptsAnyConfig());
  it("accepts an empty config on simulator", () => assertASimulatorRtuAcceptsAnEmptyConfig());
  it("keeps the over-long topic row", () => assertTheOverLongTopicRowStays());
  it("keeps the topic-required row", () => assertTheTopicRequiredRowStays());
  it("keeps the credentials-required row", () => assertTheCredentialsRequiredRowStays());
});
