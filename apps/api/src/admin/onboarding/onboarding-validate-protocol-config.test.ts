import { describe, it } from "vitest";

import {
  assertAnEmptyTopicBesideALegacyKeyIsRequired,
  assertAnEmptyTopicBesideALegacyKeyGivesOneConfigRow,
  assertALegacyTopicAloneHasNoConfigError,
  assertAnAbsentTopicIsRequired,
  assertAnAbsentTopicGivesOneConfigRow,
  assertAPlainTopicHasNoConfigError,
  assertAWhitespaceTopicPassesTheRequiredCheck,
  assertAFallbackTopicWildcardIsReportedOnce,
  assertAHeadTopicWildcardIsReportedOnce,
  assertAShadowedFallbackWildcardKeepsItsSchemaRow,
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
  it("reports a mqttTopic fallback wildcard once (F3.24a review L1)", () => assertAFallbackTopicWildcardIsReportedOnce());
  it("keeps the schema row for a mqttTopic wildcard that topic shadows", () =>
    assertAShadowedFallbackWildcardKeepsItsSchemaRow());
  it("refuses rejectUnauthorized", () => assertRejectUnauthorizedIsRefused());
  it("accepts any config on modbus_tcp", () => assertAModbusRtuAcceptsAnyConfig());
  it("accepts an empty config on simulator", () => assertASimulatorRtuAcceptsAnEmptyConfig());
  it("keeps the over-long topic row", () => assertTheOverLongTopicRowStays());
  it("keeps the topic-required row", () => assertTheTopicRequiredRowStays());
  it("keeps the credentials-required row", () => assertTheCredentialsRequiredRowStays());
  it("requires a topic when topic is empty beside a legacy mqttTopic (F4.234)", () => assertAnEmptyTopicBesideALegacyKeyIsRequired());
  it("gives one config row for that case (F4.234)", () => assertAnEmptyTopicBesideALegacyKeyGivesOneConfigRow());
  it("accepts a legacy mqttTopic alone (F4.234)", () => assertALegacyTopicAloneHasNoConfigError());
  it("requires a topic when no topic key exists (F4.234)", () => assertAnAbsentTopicIsRequired());
  it("gives one config row for an absent topic (F4.234)", () => assertAnAbsentTopicGivesOneConfigRow());
  it("accepts a plain topic (F4.234)", () => assertAPlainTopicHasNoConfigError());
  it("keeps a whitespace topic passing the required check (F4.234)", () => assertAWhitespaceTopicPassesTheRequiredCheck());
});
