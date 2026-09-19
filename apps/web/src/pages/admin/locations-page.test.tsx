// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  editPrefillsTheTimezone,
  emptyTimezoneSubmitsNull,
  formHasATimezoneInputWithADatalist,
  listRendersDashForANullTimezone,
  typedTimezoneIsSubmitted,
} from "./locations-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * The `@vitest-environment jsdom` docblock is on THIS file because Vitest
 * reads it from the file it collects (ADR 0042 decision 2). The project
 * default stays `node`.
 */
describe("E4.1b locations page — the Timezone field", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("W1 the form has a Timezone input bound to a datalist with at least one option", async () => {
    await formHasATimezoneInputWithADatalist();
  });

  it("W2 an empty Timezone field submits timezone: null", async () => {
    await emptyTimezoneSubmitsNull();
  });

  it("W3 a typed zone is submitted as typed, Province untouched", async () => {
    await typedTimezoneIsSubmitted();
  });

  it("W4 editing a row with Africa/Johannesburg prefills the input", async () => {
    await editPrefillsTheTimezone();
  });

  it("W5 the list renders — for a null timezone and the name where set", async () => {
    await listRendersDashForANullTimezone();
  });
});
