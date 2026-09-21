import { describe, it } from "vitest";

import {
  assertAColonJobIdIsRefusedAtEnqueue,
  assertACalendarInvalidDateIsRefused,
  assertAnExtraKeyIsRefused,
  assertEnqueueReachesAddWithTheRenderJobId,
  assertMissingOrganizationIdIsRefused,
  assertPeriodEndBeforePeriodStartIsRefused,
  assertRenderJobIdIsScheduleUnderscorePeriodEnd,
  assertRenderJobIdMatchesTheJobIdPattern,
  assertReportsRenderQueueIsNamedReportsRender,
  assertReportsRenderQueueIsTenant,
  assertValidPayloadReachesAdd,
} from "./reports-render.spec";

/**
 * F3.5b (ADR 0071 decision 8, R-1) — Vitest entry point for the
 * `reports-render` declaration and `renderJobId`. Assertions live in the
 * sibling `.spec` (§4.6/ADR 0014); this file only runs them.
 */
describe("F3.5b — reports-render declaration and renderJobId", () => {
  it("declares reports-render as a tenant queue", () => {
    assertReportsRenderQueueIsTenant();
  });

  it("names the queue reports-render", () => {
    assertReportsRenderQueueIsNamedReportsRender();
  });

  it("builds a renderJobId matching JOB_ID_PATTERN, with no colon", () => {
    assertRenderJobIdMatchesTheJobIdPattern();
  });

  it("builds renderJobId as scheduleId_periodEnd", () => {
    assertRenderJobIdIsScheduleUnderscorePeriodEnd();
  });

  it("reaches enqueue's add with the renderJobId", async () => {
    await assertEnqueueReachesAddWithTheRenderJobId();
  });

  it("refuses a colon jobId at enqueue before add is called", async () => {
    await assertAColonJobIdIsRefusedAtEnqueue();
  });

  it("enqueues a valid payload", async () => {
    await assertValidPayloadReachesAdd();
  });

  it("refuses a calendar-invalid periodStart", async () => {
    await assertACalendarInvalidDateIsRefused();
  });

  it("refuses periodEnd before periodStart", async () => {
    await assertPeriodEndBeforePeriodStartIsRefused();
  });

  it("refuses a missing organizationId", async () => {
    await assertMissingOrganizationIdIsRefused();
  });

  it("refuses a smuggled extra key", async () => {
    await assertAnExtraKeyIsRefused();
  });
});
