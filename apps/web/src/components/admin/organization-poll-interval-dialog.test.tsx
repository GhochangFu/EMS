// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aBadValueOrARefusalStays,
  anEmptyFieldSendsNull,
  overSixMinutesWarns,
  theDialogOpensOnTheStoredValue,
} from "./organization-poll-interval-dialog.spec";

/** `F1.2` — the organization Poll interval dialog (ADR 0141 decision 10, plan P4). */
describe("F1.2 — OrganizationPollIntervalDialog", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("I1 opens on the stored value in seconds and says what empty means", async () => {
    await theDialogOpensOnTheStoredValue();
  });

  it("I2 an empty field sends null, refreshes and closes", async () => {
    await anEmptyFieldSendsNull();
  });

  it("I3 a value over 360 s shows P4's sentence; 360 does not", async () => {
    await overSixMinutesWarns();
  });

  it("I4 an out-of-bound value sends nothing; a refusal shows inline and stays", async () => {
    await aBadValueOrARefusalStays();
  });
});
