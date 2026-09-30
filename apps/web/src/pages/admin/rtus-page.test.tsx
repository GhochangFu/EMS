// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aTakenDeviceIdShowsTheApiSentence,
  createSendsTheTrimmedDeviceId,
  createWithABlankDeviceIdOmitsTheKey,
  editClearingTheDeviceIdSendsEmpty,
  editSendsAChangedDeviceId,
  editWithTheDeviceIdUntouchedOmitsTheKey,
  listShowsTheDeviceIdAndADashWhenUnset,
} from "./rtus-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F4.182 RTUs admin page — device ID (rtu_code)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("R1 the list shows the device ID, and a dash where it is unset", async () => {
    await listShowsTheDeviceIdAndADashWhenUnset();
  });

  it("R2 create sends the typed device ID, trimmed", async () => {
    await createSendsTheTrimmedDeviceId();
  });

  it("R3 create with a blank device ID sends no rtuCode key", async () => {
    await createWithABlankDeviceIdOmitsTheKey();
  });

  it("R4 an edit that leaves the device ID alone sends no rtuCode key", async () => {
    await editWithTheDeviceIdUntouchedOmitsTheKey();
  });

  it("R5 an edit sends a changed device ID, trimmed, for that RTU", async () => {
    await editSendsAChangedDeviceId();
  });

  it("R6 clearing a stored device ID sends an empty string", async () => {
    await editClearingTheDeviceIdSendsEmpty();
  });

  it("R7 a taken device ID shows the API sentence, not the JSON envelope", async () => {
    await aTakenDeviceIdShowsTheApiSentence();
  });
});
