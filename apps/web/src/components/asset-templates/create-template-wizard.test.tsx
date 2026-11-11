// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aBadPrefixHoldsTheStepWithItsSentence,
  theBasicsStepOffersAnUpperCasingPrefixField,
  theCreateInputSendsThePrefixOnlyWhenFilled,
} from "./create-template-wizard.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E3.1 create template wizard — work-order prefix", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("sends the prefix only when filled", () => {
    theCreateInputSendsThePrefixOnlyWhenFilled();
  });

  it("offers an upper-casing prefix field on the basics step", async () => {
    await theBasicsStepOffersAnUpperCasingPrefixField();
  });

  it("holds the step, with the sentence, while the prefix is malformed", async () => {
    await aBadPrefixHoldsTheStepWithItsSentence();
  });
});
