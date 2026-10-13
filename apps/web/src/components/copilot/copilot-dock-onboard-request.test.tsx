// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { useAuthStore } from "../../stores/auth-store";
import { resetCopilotStore } from "../../stores/copilot-store";
import {
  aRequestDoesNotStartASecondSkill,
  aRequestFiledAfterTheMountStartsTheSkillOnce,
  aSwitchedOffOrganizationStartsNothing,
  anExpiredOrForeignRequestIsDropped,
  oneRequestStartsTheSkillExactlyOnce,
  theGlobalAdminsRequestPicksThatOrganization,
} from "./copilot-dock-onboard-request.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). The
 * `@vitest-environment jsdom` docblock is on THIS file (ADR 0042 decision 2).
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAuthStore.setState({ scope: null });
  resetCopilotStore();
  window.localStorage.clear();
});

describe("F3.86 PR 7 copilot dock — the onboarding request", () => {
  it("one request leads to exactly one start call, after a re-render and under StrictMode", oneRequestStartsTheSkillExactlyOnce);
  it("a request filed after the mount starts the skill once", aRequestFiledAfterTheMountStartsTheSkillOnce);
  it("a request does not start a second skill when one is bound", aRequestDoesNotStartASecondSkill);
  it("with the organization's switch off, nothing starts and the off sentence shows", aSwitchedOffOrganizationStartsNothing);
  it("the global admin's request picks that organization", theGlobalAdminsRequestPicksThatOrganization);
  it("an expired or another user's request is dropped", anExpiredOrForeignRequestIsDropped);
});
