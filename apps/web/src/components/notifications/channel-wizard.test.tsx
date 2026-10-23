// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { resetWizardStore } from "../../stores/wizard-store";
import {
  aWebhookCreateSendsTheUrlAndTheSecret,
  theTestWizardSendsOnSubmit,
  theToggleOfADisabledChannelReactivates,
  theToggleSendsEnabledFalse,
} from "./channel-wizard.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014); the jsdom docblock is here (ADR 0042). */
describe("F4.279 — the channel wizards (ADR 0099 decision 6)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    resetWizardStore();
  });

  it("a webhook create sends the URL in config and the typed secret", () => aWebhookCreateSendsTheUrlAndTheSecret());
  it("the toggle of an enabled channel sends enabled false", () => theToggleSendsEnabledFalse());
  it("the toggle of a disabled channel reactivates it", () => theToggleOfADisabledChannelReactivates());
  it("the test wizard sends on Submit", () => theTestWizardSendsOnSubmit());
});
