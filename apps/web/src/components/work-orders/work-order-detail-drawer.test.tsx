// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aCancelledTicketReadsNoSla,
  aRejectRefreshesTheDrawer,
  aResolvedTicketOffersRejectAndCancelToAnApprover,
  aTerminalTicketIsLocked,
  aTicketThatCannotBeReadShowsASentence,
  aTicketWithNoSnapshotShowsNoAlarmBlock,
  aViewerReadsAndWritesNothing,
  aWriteInsideTheDrawerReadsTheTicketAgain,
  anApproverSeesRejectAndCancelWhereTheyApply,
  anOperatorSeesNoRejectAndNoCancel,
  anOperatorWritesTheChecklistAndTheRootCauseOnALiveTicket,
  closeDetailsCallsThePageBack,
  theDrawerShowsTheTicket,
  typedFindingsSurviveAChecklistTick,
} from "./work-order-detail-drawer.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E3.1 — the work-order detail drawer (ADR 0122 decision 8)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the reference, the SLA, the five steps and every part of the ticket", async () => {
    await theDrawerShowsTheTicket();
  });

  it("shows no From the alarm block for a ticket with no snapshot", async () => {
    await aTicketWithNoSnapshotShowsNoAlarmBlock();
  });

  it("offers an approver cancel, and no reject, on a live ticket", async () => {
    await anApproverSeesRejectAndCancelWhereTheyApply();
  });

  it("offers an approver reject and cancel on a resolved ticket", async () => {
    await aResolvedTicketOffersRejectAndCancelToAnApprover();
  });

  it("offers an operator neither reject nor cancel", async () => {
    await anOperatorSeesNoRejectAndNoCancel();
  });

  it("lets an operator write the checklist and the root cause on a live ticket", async () => {
    await anOperatorWritesTheChecklistAndTheRootCauseOnALiveTicket();
  });

  it("is read-only for a viewer", async () => {
    await aViewerReadsAndWritesNothing();
  });

  it("reads No SLA for a cancelled ticket that kept its minutes", async () => {
    await aCancelledTicketReadsNoSla();
  });

  it("keeps a finding being typed when a checklist tick re-reads the ticket", async () => {
    await typedFindingsSurviveAChecklistTick();
  });

  it("shows the ticket In progress, with no reject form, after a reject", async () => {
    await aRejectRefreshesTheDrawer();
  });

  it("locks the checklist and the root cause of a closed or cancelled ticket and offers no reject or cancel", async () => {
    await aTerminalTicketIsLocked();
  });

  it("reads the ticket again after a write inside it", async () => {
    await aWriteInsideTheDrawerReadsTheTicketAgain();
  });

  it("calls the page back on Close details", async () => {
    await closeDetailsCallsThePageBack();
  });

  it("shows one sentence for a ticket that cannot be read", async () => {
    await aTicketThatCannotBeReadShowsASentence();
  });
});
