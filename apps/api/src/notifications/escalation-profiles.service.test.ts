import { describe, it } from "vitest";

import {
  aMatchingIfMatchWrites,
  aStaleIfMatchIsA412,
  aStaleIfMatchWritesNoAuditRow,
  noIfMatchKeepsTheNotFound,
  runEscalationProfilesServiceTests,
  theCreateAuditsThroughTheFunnel,
} from "./escalation-profiles.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.10 escalation profiles service", () => {
  it("resolves the organization, refuses an unpairable channel before writing, and audits every write", async () => {
    await runEscalationProfilesServiceTests();
  });
});

/** `F4.279` (ADR 0099 Amendment 8 D6, "Common to every entry"). */
describe("F4.279 — the profile PATCH takes If-Match, and every write audits through the funnel", () => {
  it("answers 412 for a stale If-Match", async () => {
    await aStaleIfMatchIsA412();
  });

  it("writes no audit row for a stale If-Match", async () => {
    await aStaleIfMatchWritesNoAuditRow();
  });

  it("keeps the route's 404 when no header is sent", async () => {
    await noIfMatchKeepsTheNotFound();
  });

  it("writes and audits for a matching If-Match", async () => {
    await aMatchingIfMatchWrites();
  });

  it("audits the create through MasterDataAuditService on the fleet pool", async () => {
    await theCreateAuditsThroughTheFunnel();
  });
});
