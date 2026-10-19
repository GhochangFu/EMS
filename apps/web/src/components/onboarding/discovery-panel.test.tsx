// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aChatTurnInFlightRenamesTheButtonAndMarksItBusy,
  aDiscoveredRowShowsTheBadgeAndTheSampleValue,
  aDoneDiscoveryShowsTheCountsAndTheTruncatedNote,
  aDoneDiscoveryWithNoDeviceShowsTheEmptySentence,
  aFailedDiscoveryShowsItsErrorClass,
  aNonMqttDraftRendersNoSection,
  aPlainRowShowsNoBadge,
  aRunningDiscoveryDisablesTheButtonAndShowsTheStatus,
  aWorkerRefusalDisablesTheButtonWithTheWorkerReason,
  theButtonIsEnabledForAnMqttRtuWithCredentials,
  withoutAHostTheButtonIsDisabledWithItsReason,
  withoutCredentialsTheButtonIsDisabledWithItsReason,
} from "./discovery-panel.spec";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("F3.24b discovery panel", () => {
  it("the button is enabled for an MQTT RTU with credentials and shows the warning", theButtonIsEnabledForAnMqttRtuWithCredentials);
  it("without credentials the button is disabled with its reason", withoutCredentialsTheButtonIsDisabledWithItsReason);
  it("without a host the button is disabled with its reason", withoutAHostTheButtonIsDisabledWithItsReason);
  it("a running discovery disables the button and shows the status", aRunningDiscoveryDisablesTheButtonAndShowsTheStatus);
  it("a chat turn in flight renames the button and marks it busy", aChatTurnInFlightRenamesTheButtonAndMarksItBusy);
  it("a draft with no MQTT RTU renders no Discover button", aNonMqttDraftRendersNoSection);
  it("a done discovery with no device shows the empty sentence", aDoneDiscoveryWithNoDeviceShowsTheEmptySentence);
  it("a done discovery shows the counts and the truncated note", aDoneDiscoveryShowsTheCountsAndTheTruncatedNote);
  it("a failed discovery shows its error class", aFailedDiscoveryShowsItsErrorClass);
  it("a discovered row shows the Discovered badge and the sample value", aDiscoveredRowShowsTheBadgeAndTheSampleValue);
  it("a plain row shows no badge", aPlainRowShowsNoBadge);
  it("a 503 from the route disables the button with the worker reason", aWorkerRefusalDisablesTheButtonWithTheWorkerReason);
});
