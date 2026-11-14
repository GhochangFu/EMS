// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { theTariffActionOpensThatLocationsTariffPage } from "./locations-page.tariff.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6). */
describe("F4.365 U8 locations page — the Tariff row action", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens that location's tariff page", async () => {
    await theTariffActionOpensThatLocationsTariffPage();
  });
});
