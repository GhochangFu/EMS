// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { anotherRoleIsSentToTheHub, theGlobalAdminSavesThePortalDefault } from "./portal-appearance-page.spec";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("data-design");
  document.documentElement.removeAttribute("data-profile");
});

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.341 the portal appearance page (ADR 0118 decision 11)", () => {
  it("PA1 the global admin saves the portal default; there is no Inherit", () => theGlobalAdminSavesThePortalDefault());
  it("PA2 another role is sent back to the hub, and nothing is read", () => anotherRoleIsSentToTheHub());
});
