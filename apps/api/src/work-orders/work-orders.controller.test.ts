import { describe, it } from "vitest";

import {
  aMalformedSlaIsA400BeforeTheSlaGate,
  aViewerIsRefusedOnTheChecklistRoutesBeforeTheBodyIsParsed,
  anAdminRoleMaySendSlaMinutes,
  anOperatorMayWriteTheChecklist,
  anOperatorSendingSlaMinutesIsRefused,
  anOperatorWithoutSlaMinutesCreatesTheTicket,
  onlyTheFourAdminRolesMayOverrideTheSla,
  theChecklistRoutesAreWhereTheAdrSays,
  theLiteralReadIsDeclaredAboveTheIdRead,
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

    it("declares the literal checklist-templates read above the :id read", () => {
      theLiteralReadIsDeclaredAboveTheIdRead();
    });

    it("declares POST :id/tasks and PATCH :id/tasks/:taskId", () => {
      theChecklistRoutesAreWhereTheAdrSays();
    });
  });
});
