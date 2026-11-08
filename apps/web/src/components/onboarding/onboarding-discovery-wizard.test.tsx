// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  a202HandsTheDiscoveryIdUp,
  a409ShowsTheConflictSentence,
  aTopicWithNoSlashIsItsOwnPrefix,
  submitPostsTheBodyToTheDiscoveryRoute,
  aPlainRtuSaysTlsOffAndPostsExpectedTlsFalse,
  theDefaultPrefixIsTheSavedTopicUpToItsLastSlash,
  theStepShowsTheBrokerTheFilterAndTheWarning,
  aChosenWindowIsShownAndPosted,
  aWindowOver300IsRefusedBeforeItIsSent,
} from "./onboarding-discovery-wizard.spec";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("F3.24b onboarding discovery wizard", () => {
  it("the default prefix is the saved topic up to its last slash", theDefaultPrefixIsTheSavedTopicUpToItsLastSlash);
  it("a topic with no slash is its own prefix", aTopicWithNoSlashIsItsOwnPrefix);
  it("the step shows the broker, the filter and the shared-user warning", theStepShowsTheBrokerTheFilterAndTheWarning);
  it("Submit posts the body to the discovery route", submitPostsTheBodyToTheDiscoveryRoute);
  it("a plain RTU says TLS off and posts expected.tls false (F4.326)", aPlainRtuSaysTlsOffAndPostsExpectedTlsFalse);
  it("a 202 hands the discovery id up", a202HandsTheDiscoveryIdUp);
  it("a 409 shows the conflict sentence and starts nothing", a409ShowsTheConflictSentence);
  it("a chosen window is shown and posted (F4.339)", aChosenWindowIsShownAndPosted);
  it("a window over 300 s is refused before it is sent (F4.339)", aWindowOver300IsRefusedBeforeItIsSent);
});
