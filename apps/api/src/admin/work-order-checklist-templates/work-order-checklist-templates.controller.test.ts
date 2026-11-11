import { describe, it } from "vitest";

import {
  aForeignOrMissingTemplateIsTheSame404,
  aLocationAdminIsRefusedByTheOrganizationCheck,
  aValidWriteRunsTheGatesInOrderThenTheService,
  anInvalidBodyOrIdFromAnAdminIs400,
  anOperatorOrViewerIsRefusedBeforeTheBodyIsParsed,
  listAnswersTheServiceValueBehindTheOrganizationCheck,
  theRoutesAreWhereTheAdrSays,
} from "./work-order-checklist-templates.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E3.1 — WorkOrderChecklistTemplatesAdminController (stubbed gates and service)", () => {
  it("declares GET, POST and PATCH :id of /admin/work-order-checklist-templates", () => {
    theRoutesAreWhereTheAdrSays();
  });

  it("refuses an operator and a viewer on POST and PATCH before the body is parsed", async () => {
    await anOperatorOrViewerIsRefusedBeforeTheBodyIsParsed();
  });

  it("refuses a location_admin on POST by the organization check", async () => {
    await aLocationAdminIsRefusedByTheOrganizationCheck();
  });

  it("answers 400 for an admin's invalid body or :id", async () => {
    await anInvalidBodyOrIdFromAnAdminIs400();
  });

  it("answers the same 404 for a foreign template and a missing one, without calling update", async () => {
    await aForeignOrMissingTemplateIsTheSame404();
  });

  it("runs the gates in order, then the service, on a valid POST and PATCH", async () => {
    await aValidWriteRunsTheGatesInOrderThenTheService();
  });

  it("answers GET from the service behind the organization check", async () => {
    await listAnswersTheServiceValueBehindTheOrganizationCheck();
  });
});
