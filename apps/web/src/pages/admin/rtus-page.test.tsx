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
  editingAPlainRtuShowsAReadOnlyTlsLine,
  editingATlsRtuShowsNoTlsLine,
  onlyAPlainRtuShowsThePlainMqttPill,
  aReleasedTopicIsNamedOnTheRow,
} from "./rtus-page.spec";

/** `F3.86` PR 3a: the form is a wizard, and a walk through its steps takes seconds under jsdom. */
const WIZARD_WALK_MS = 20_000;

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

  it("R8 shows the Plain MQTT pill for tls:false only (F4.326)", async () => {
    await onlyAPlainRtuShowsThePlainMqttPill();
  });

  it("R9 shows a read-only TLS line when editing a plain RTU, and no TLS input (F4.326)", async () => {
    await editingAPlainRtuShowsAReadOnlyTlsLine();
  });

  it("R9b shows no TLS line when editing a TLS RTU (F4.326)", async () => {
    await editingATlsRtuShowsNoTlsLine();
  });

  it("F4.339 names a released topic on the row", async () => {
    await aReleasedTopicIsNamedOnTheRow();
  });
}, WIZARD_WALK_MS);
