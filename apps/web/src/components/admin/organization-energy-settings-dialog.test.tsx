// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aRefusalShowsInlineAndStays,
  saveIsBusyAndCancelWritesNothing,
  saveSendsBothKeysAndRefreshes,
  theDialogOpensOnTheStoredValues,
} from "./organization-energy-settings-dialog.spec";

/** `F4.375` — the organization Energy settings dialog (ADR 0133 Amendment 2 ruling 3). */
describe("F4.375 — OrganizationEnergySettingsDialog", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("D1 opens on the stored values with the plan's labels", async () => {
    await theDialogOpensOnTheStoredValues();
  });

  it("D2 Save sends both keys, refreshes the three queries and closes", async () => {
    await saveSendsBothKeysAndRefreshes();
  });

  it("D3 a refusal shows the server's sentence inline and the dialog stays", async () => {
    await aRefusalShowsInlineAndStays();
  });

  it("D4 Save is busy while pending; Cancel writes nothing", async () => {
    await saveIsBusyAndCancelWritesNothing();
  });
});
