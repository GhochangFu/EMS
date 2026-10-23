// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { resetWizardStore } from "../../stores/wizard-store";
import { aMapWithAPairSendsTheSet, anEmptyMapMountsTheRedClear } from "./escalation-defaults-wizard.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014); the jsdom docblock is here (ADR 0042). */
describe("F4.279 — the severity map wizard (ADR 0099 Amendment 8 D3)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    resetWizardStore();
  });

  it("an empty map mounts the red clear entry", () => anEmptyMapMountsTheRedClear());
  it("a map with a pair sends the set entry", () => aMapWithAPairSendsTheSet());
});
