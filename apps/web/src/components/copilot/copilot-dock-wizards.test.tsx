// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { useAuthStore } from "../../stores/auth-store";
import { resetCopilotStore } from "../../stores/copilot-store";
import { resetWizardStore } from "../../stores/wizard-store";
import {
  aFillAfterOpenPageWaitsOnThatPage,
  aTurnNamesTheWizardsOpenAtSendTime,
  aWaitingFillIsDroppedWhenTheUserMovesOn,
} from "./copilot-dock-wizards.spec";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAuthStore.setState({ scope: null });
  resetCopilotStore();
  resetWizardStore();
  window.localStorage.clear();
});

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042). */
describe("F4.245 copilot dock — the open wizards ride with each turn (ADR 0099 Amendment 4)", () => {
  it("names the wizards open at send time", () => aTurnNamesTheWizardsOpenAtSendTime());
  it("keeps a fill after open_page waiting on that page", () => aFillAfterOpenPageWaitsOnThatPage());
  it("drops a waiting fill when the user moves on", () => aWaitingFillIsDroppedWhenTheUserMovesOn());
});
