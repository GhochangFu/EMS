// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aBadPrefixKeepsSaveDisabled,
  aRefusalShowsTheSentence,
  clearingSendsNull,
  failsClosedForEveryOtherRole,
  rendersEachDomainWithItsPrefix,
  saveSendsTheNewPrefix,
  upperCasesWhatIsTyped,
} from "./asset-domains-page.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014); `E3.1`, ADR 0122. */
describe("E3.1 Asset Domains admin page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("A1 fails closed for every role but admin, with no request", async () => {
    await failsClosedForEveryOtherRole();
  });
  it("A2 renders each domain with its prefix", async () => {
    await rendersEachDomainWithItsPrefix();
  });
  it("A3 upper-cases what is typed", async () => {
    await upperCasesWhatIsTyped();
  });
  it("A4 a bad prefix keeps Save disabled and shows the hint", async () => {
    await aBadPrefixKeepsSaveDisabled();
  });
  it("A5 Save sends the new prefix", async () => {
    await saveSendsTheNewPrefix();
  });
  it("A6 clearing the field sends null", async () => {
    await clearingSendsNull();
  });
  it("A7 a refusal shows the server's sentence", async () => {
    await aRefusalShowsTheSentence();
  });
});
