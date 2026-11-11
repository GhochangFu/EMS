import { describe, it } from "vitest";

import {
  aCancelTakesAnyLiveOrResolvedTicket,
  aMissingRootCauseBlocksResolve,
  aResolvedAlarmTicketKeepsItsFindings,
  aResolvedTicketGoesBackToInProgressOnly,
  findingsAreFrozenAtClosed,
  onlyAnAlarmTicketOwesARootCause,
  theChecklistIsNamedBeforeTheRootCause,
  theResolveStampsClearOnTheWayBack,
  aFullChecklistRefusesOneMore,
  aPendingMandatoryItemBlocksResolve,
  aRefusalThrowsTheErrorOfItsStatus,
  aReorderIntoResolvedIsRefused,
  aReorderNeverTouchesACancelledTicket,
  aReorderStillRefusesDone,
  aReorderWithinOrOutOfResolvedIsAllowed,
  aResolvedOrClosedTicketFreezesItsChecklist,
  aTerminalTicketRefusesEveryStatusWrite,
  aTicketAlreadyResolvedIsNotGatedAgain,
  liveStatusesMoveFreely,
  onlyAResolvedTicketIsApproved,
  onlyAResolvedTicketIsRejected,
  resolvePassesWhenNoMandatoryItemIsPending,
  selfApprovalIsTheApproverBeingTheResolver,
  theChecklistIsReadOnlyWhenItDecides,
  theStatusRouteNeverClosesOrCancels,
} from "./work-order-transitions.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E3.1 — work-order transitions (ADR 0122, plan D9)", () => {
  it("lets open, assigned and in_progress move freely among themselves", () => {
    liveStatusesMoveFreely();
  });

  it("blocks the move into resolved while a mandatory item is pending (409)", () => {
    aPendingMandatoryItemBlocksResolve();
  });

  it("lets the move into resolved pass when no mandatory item is pending", () => {
    resolvePassesWhenNoMandatoryItemIsPending();
  });

  it("does not gate a ticket that is already resolved", () => {
    aTicketAlreadyResolvedIsNotGatedAgain();
  });

  it("never closes or cancels through the status route (400)", () => {
    theStatusRouteNeverClosesOrCancels();
  });

  it("reads the checklist only for the moves it decides", () => {
    theChecklistIsReadOnlyWhenItDecides();
  });

  it("refuses every status write on a closed or cancelled ticket (400)", () => {
    aTerminalTicketRefusesEveryStatusWrite();
  });

  it("approves a resolved ticket only (409 from a live status, 400 from a terminal one)", () => {
    onlyAResolvedTicketIsApproved();
  });

  it("rejects a resolved ticket only (409 from a live status, 400 from a terminal one)", () => {
    onlyAResolvedTicketIsRejected();
  });

  it("cancels any live or resolved ticket, and no terminal one (400)", () => {
    aCancelTakesAnyLiveOrResolvedTicket();
  });

  it("marks self-approval only when the approver is the recorded resolver", () => {
    selfApprovalIsTheApproverBeingTheResolver();
  });

  it("refuses a reorder into resolved (400, ruling P1)", () => {
    aReorderIntoResolvedIsRefused();
  });

  it("allows a reorder within resolved and back to in_progress", () => {
    aReorderWithinOrOutOfResolvedIsAllowed();
  });

  it("still refuses a reorder into or out of Done", () => {
    aReorderStillRefusesDone();
  });

  it("never moves a cancelled ticket, or a card into cancelled, by reorder (400)", () => {
    aReorderNeverTouchesACancelledTicket();
  });

  it("freezes the checklist of a resolved, closed or cancelled ticket (409)", () => {
    aResolvedOrClosedTicketFreezesItsChecklist();
  });

  it("refuses the hundred and first checklist item (409)", () => {
    aFullChecklistRefusesOneMore();
  });

  it("throws the HTTP error of a refusal's status", () => {
    aRefusalThrowsTheErrorOfItsStatus();
  });

  describe("root cause and leaving resolved (PR 4)", () => {
    it("owes a root cause only on a ticket raised from an alarm", () => {
      onlyAnAlarmTicketOwesARootCause();
    });

    it("blocks resolved while an alarm ticket's root cause is missing (409)", () => {
      aMissingRootCauseBlocksResolve();
    });

    it("names the checklist before the root cause", () => {
      theChecklistIsNamedBeforeTheRootCause();
    });

    it("lets a resolved ticket go back to in_progress only (ruling P3)", () => {
      aResolvedTicketGoesBackToInProgressOnly();
    });

    it("clears the resolve stamps exactly on the way back to work", () => {
      theResolveStampsClearOnTheWayBack();
    });

    it("freezes the findings at closed (409)", () => {
      findingsAreFrozenAtClosed();
    });

    it("keeps a resolved alarm ticket's findings", () => {
      aResolvedAlarmTicketKeepsItsFindings();
    });
  });
});
