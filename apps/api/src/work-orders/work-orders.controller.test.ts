import { describe, it } from "vitest";

import {
  aBadApprovalRequestIs400,
  aBadRootCauseBodyIs400,
  aReorderItemMayNotBeCancelled,
  aMalformedSlaIsA400BeforeTheSlaGate,
  aViewerIsRefusedOnTheChecklistRoutesBeforeTheBodyIsParsed,
  anAdminRoleMaySendSlaMinutes,
  anOperatorMayWriteTheChecklist,
  anOperatorSendingSlaMinutesIsRefused,
  anOperatorWithoutSlaMinutesCreatesTheTicket,
  onlyTheFourAdminRolesMayOverrideTheSla,
  theApprovalRoutesAreWhereTheAdrSays,
  theApprovalRoutesAskForApprovalBeforeAnythingElse,
  theCauseCodeListIsAPlainRead,
  theFourAdminRolesMayApproveRejectAndCancel,
  theStatusRouteRefusesClosedAndCancelled,
  theChecklistRoutesAreWhereTheAdrSays,
  theLiteralReadIsDeclaredAboveTheIdRead,
  theRootCauseRouteIsOperational,
  theTemplateListIsAReadBehindTheAssetScope,
} from "./work-orders.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E3.1 — WorkOrdersController (stubbed gates and services)", () => {
  describe("the per-ticket SLA override is admin-only (owner ruling, 2026-11-11)", () => {
    it("lets exactly the four admin roles override the SLA", () => {
      onlyTheFourAdminRolesMayOverrideTheSla();
    });

    it("refuses an operator who sends slaMinutes (403) and creates nothing", async () => {
      await anOperatorSendingSlaMinutesIsRefused();
    });

    it("lets an operator create a ticket without slaMinutes", async () => {
      await anOperatorWithoutSlaMinutesCreatesTheTicket();
    });

    it("lets each admin role send slaMinutes", async () => {
      await anAdminRoleMaySendSlaMinutes();
    });

    it("answers 400 for a malformed slaMinutes before the SLA gate", async () => {
      await aMalformedSlaIsA400BeforeTheSlaGate();
    });
  });

  describe("the checklist routes", () => {
    it("refuses a viewer by role before the ids and the body are parsed", async () => {
      await aViewerIsRefusedOnTheChecklistRoutesBeforeTheBodyIsParsed();
    });

    it("lets an operator add and tick an item, and answers 400 for a bad id or body", async () => {
      await anOperatorMayWriteTheChecklist();
    });

    it("serves the template list as a read behind the asset scope", async () => {
      await theTemplateListIsAReadBehindTheAssetScope();
    });

    it("declares the literal checklist-templates and cause-codes reads above the :id read", () => {
      theLiteralReadIsDeclaredAboveTheIdRead();
    });

    it("declares POST :id/tasks and PATCH :id/tasks/:taskId", () => {
      theChecklistRoutesAreWhereTheAdrSays();
    });
  });

  describe("root cause (PR 4)", () => {
    it("gates PUT :id/root-cause on the operational class", async () => {
      await theRootCauseRouteIsOperational();
    });

    it("answers 400 for a root-cause body with a snapshot key or a missing one", async () => {
      await aBadRootCauseBodyIs400();
    });

    it("serves the cause codes as a plain read", async () => {
      await theCauseCodeListIsAPlainRead();
    });
  });

  describe("approval, reject and cancel (PR 5)", () => {
    it("asks close, reject and cancel for the approval class before the id, the body and the scope", async () => {
      await theApprovalRoutesAskForApprovalBeforeAnythingElse();
    });

    it("lets each of the four admin roles close, reject and cancel", async () => {
      await theFourAdminRolesMayApproveRejectAndCancel();
    });

    it("answers 400 for a bad id, a missing reason or a stray key", async () => {
      await aBadApprovalRequestIs400();
    });

    it("declares POST :id/close, :id/reject and :id/cancel, each answering 200", () => {
      theApprovalRoutesAreWhereTheAdrSays();
    });

    it("answers 400 for PATCH status with closed or cancelled", async () => {
      await theStatusRouteRefusesClosedAndCancelled();
    });

    it("answers 400 for a reorder item with cancelled", async () => {
      await aReorderItemMayNotBeCancelled();
    });
  });
});
