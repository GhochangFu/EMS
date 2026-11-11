import { describe, it } from "vitest";

import {
  copilotNeverSendsAChecklistTemplate,
  createBodyTakesAChecklistTemplate,
  detailCarriesTheChecklist,
  itemRequiresBothChecklistCounters,
  scheduleBodiesTakeAChecklistTemplate,
  taskBodiesAreStrictAndAnUpdateNeedsAField,
  taskResultsAreTheThreeRuled,
  taskRowRoundTrips,
  templateBodiesAreStrict,
  templateListRoundTrips,
} from "./work-order-checklists.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E3.1 — work-order checklist contracts, PR 3 (ADR 0122 decision 4)", () => {
  it("requires checklistDone and checklistTotal on the list item", () => {
    itemRequiresBothChecklistCounters();
  });

  it("names the three ruled task results", () => {
    taskResultsAreTheThreeRuled();
  });

  it("round-trips a task row", () => {
    taskRowRoundTrips();
  });

  it("carries the checklist on the detail, still as a z.intersection", () => {
    detailCarriesTheChecklist();
  });

  it("takes an optional checklist template on the create body and keeps it strict", () => {
    createBodyTakesAChecklistTemplate();
  });

  it("keeps the task bodies strict and refuses an empty update", () => {
    taskBodiesAreStrictAndAnUpdateNeedsAField();
  });

  it("keeps the template bodies strict", () => {
    templateBodiesAreStrict();
  });

  it("round-trips the template list", () => {
    templateListRoundTrips();
  });

  it("lets a schedule name a checklist template", () => {
    scheduleBodiesTakeAChecklistTemplate();
  });

  it("keeps checklistTemplateId out of the copilot's model bodies", () => {
    copilotNeverSendsAChecklistTemplate();
  });
});
