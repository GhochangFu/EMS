// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  rendersBothKinds,
  showsTheReadinessWarning,
  showsTheServerRefusalOnSave,
  showsWhetherASecretIsStoredWithoutShowingIt,
  surfacesAGuardRefusalAsVisibleText,
  surfacesASuccessfulTest,
} from "./notification-channels-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * The `@vitest-environment jsdom` docblock is on THIS file because Vitest reads
 * it from the file it collects (ADR 0042 decision 2). The project default stays
 * `node`; the twenty pure-logic tests beside this one do not want a DOM.
 */
describe("F3.8 notification channels page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("lists both channel kinds with what each sends to", async () => {
    await rendersBothKinds();
  });

  it("says a secret is set without ever showing or pre-filling it", async () => {
    await showsWhetherASecretIsStoredWithoutShowingIt();
  });

  it("surfaces an egress-guard refusal as visible text, not a silent no-op", async () => {
    await surfacesAGuardRefusalAsVisibleText();
  });

  it("surfaces a successful send test", async () => {
    await surfacesASuccessfulTest();
  });

  it("shows the server's reason when a save is refused", async () => {
    await showsTheServerRefusalOnSave();
  });

  it("warns when a transport is not configured", async () => {
    await showsTheReadinessWarning();
  });
});
