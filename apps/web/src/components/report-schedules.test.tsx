// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { resetWizardStore } from "../stores/wizard-store";
import {
  aDeleteInFlightDisablesThatRowsEdit,
  aDeleteInFlightEditCarriesNoAriaBusy,
  aPendingDeleteHasAriaBusyTrue,
  anIdleDeleteHasAriaBusyFalse,
  deleteCallsTheApiOnceAndRefetches,
  editPrefillsTheName,
  newScheduleOpensTheCreateWizard,
  twoDeletesInFlightKeepBothButtonsPending,
  twoSchedulesRenderTwoRows,
} from "./report-schedules.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2). `F4.280`: the form claims run in
 * `report-schedule-wizard.test.tsx`.
 */
describe("F3.5b report schedules section", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    resetWizardStore();
  });

  it("two DTOs render two rows", async () => {
    await twoSchedulesRenderTwoRows();
  });

  it("F4.280: New schedule opens the create wizard", async () => {
    await newScheduleOpensTheCreateWizard();
  });

  it("Edit opens the edit wizard pre-filled with the name", async () => {
    await editPrefillsTheName();
  });

  it("Delete calls deleteReportSchedule once and refetches the list", async () => {
    await deleteCallsTheApiOnceAndRefetches();
  });

  it("two deletes in flight keep both Delete buttons on Deleting…", async () => {
    await twoDeletesInFlightKeepBothButtonsPending();
  });

  it("a delete in flight disables that row's Edit and not the other's", async () => {
    await aDeleteInFlightDisablesThatRowsEdit();
  });

  it("F4.168: a delete in flight leaves that row's Edit with no aria-busy", async () => {
    await aDeleteInFlightEditCarriesNoAriaBusy();
  });

  it("a pending Delete carries aria-busy=\"true\"", async () => {
    await aPendingDeleteHasAriaBusyTrue();
  });

  it("another row's idle Delete carries aria-busy=\"false\"", async () => {
    await anIdleDeleteHasAriaBusyFalse();
  });
});
