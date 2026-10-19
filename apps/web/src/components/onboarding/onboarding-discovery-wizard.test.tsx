// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  a202HandsTheDiscoveryIdUp,
  a409ShowsTheConflictSentence,
  aTopicWithNoSlashIsItsOwnPrefix,
  submitPostsTheBodyToTheDiscoveryRoute,
  theDefaultPrefixIsTheSavedTopicUpToItsLastSlash,
  theStepShowsTheBrokerTheFilterAndTheWarning,
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
  it("a 202 hands the discovery id up", a202HandsTheDiscoveryIdUp);
  it("a 409 shows the conflict sentence and starts nothing", a409ShowsTheConflictSentence);
});
