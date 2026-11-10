import { describe, it } from "vitest";

import {
  aPutFromALocationAdminIsRefusedByTheOrganizationCheck,
  aPutFromAnOperatorOrViewerIsRefusedBeforeTheBodyIsParsed,
  aValidPutRunsTheGatesInOrderThenTheService,
  anInvalidBodyFromAnAdminIs400,
  getAnswersTheServiceValueBehindTheOrganizationCheck,
  theRoutesAreWhereThePlanSays,
} from "./work-order-sla-policies.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E3.1 — WorkOrderSlaPoliciesAdminController (stubbed gates and service)", () => {
  it("declares GET and PUT /admin/work-order-sla-policies", () => {
    theRoutesAreWhereThePlanSays();
  });

  it("refuses an operator and a viewer on PUT before the body is parsed", async () => {
    await aPutFromAnOperatorOrViewerIsRefusedBeforeTheBodyIsParsed();
  });

  it("refuses a location_admin on PUT by the organization check", async () => {
    await aPutFromALocationAdminIsRefusedByTheOrganizationCheck();
  });

  it("answers 400 for an admin's invalid body", async () => {
    await anInvalidBodyFromAnAdminIs400();
  });

  it("runs the role gate, the body parse and the organization check in order, then the service", async () => {
    await aValidPutRunsTheGatesInOrderThenTheService();
  });

  it("answers GET from the service behind the organization check", async () => {
    await getAnswersTheServiceValueBehindTheOrganizationCheck();
  });
});
