// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aRefusalShowsInlineAndStays,
  anEmptyIntervalSendsNull,
  noProfileSaysWhereToMakeOne,
  overSixMinutesWarnsAndTheAdapterDefaultIsNamed,
  theDialogOpensOnTheStoredBind,
} from "./rtu-modbus-dialog.spec";

/** `F1.2` — the RTU Modbus settings dialog (ADR 0141 decisions 10 and 15, plan P4). */
describe("F1.2 — RtuModbusDialog", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("R1 opens on the stored bind with the organization's profiles", async () => {
    await theDialogOpensOnTheStoredBind();
  });

  it("R2 an empty interval sends null and the body names the profile", async () => {
    await anEmptyIntervalSendsNull();
  });

  it("R3 a value over 360 s shows P4's sentence; the adapter default is named", async () => {
    await overSixMinutesWarnsAndTheAdapterDefaultIsNamed();
  });

  it("R4 a refusal shows inline and stays; no profile sends nothing", async () => {
    await aRefusalShowsInlineAndStays();
  });

  it("R5 an organization with no profile says where to make one", async () => {
    await noProfileSaysWhereToMakeOne();
  });
});
