// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  theListKeepsOneReferenceWhileTheReadHasNoData,
  theOnlyOrganizationIsChosen,
  twoOrganizationsLeaveTheChoiceOpen,
} from "./use-organization-choice.spec";

/**
 * `F4.212` — Vitest entry point for `useOrganizationChoice`; assertions live in the sibling
 * `.spec` (ADR 0014), one claim per `it()`.
 */
describe("F4.212 useOrganizationChoice", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("the list keeps one reference while the read has no data", async () => {
    await theListKeepsOneReferenceWhileTheReadHasNoData();
  });

  it("the only organization is chosen", async () => {
    await theOnlyOrganizationIsChosen();
  });

  it("two organizations leave the choice open", async () => {
    await twoOrganizationsLeaveTheChoiceOpen();
  });
});
