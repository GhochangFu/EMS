// @vitest-environment jsdom

import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { theSidebarShellIsTodaysMarkup } from "./sidebar-shell-markup.spec";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.341 the sidebar shell is today's shell, moved", () => {
  it("SS1 the header, the top navigation and the sidebar render byte for byte as before", async () => {
    await theSidebarShellIsTodaysMarkup();
  });
});
