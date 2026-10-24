import { describe, it } from "vitest";

import {
  aCreateInNoAllowedOrganizationIsRefused,
  aGlobalAdminResolvesAnySchedule,
  anOperatorIsRefusedBeforeTheScope,
  aScheduleOutsideTheReadScopeIsRefused,
  aViewerIsRefusedBeforeTheScope,
  everyCopilotRoleInScopeResolvesTheSchedule,
  theCreateResolvesTheBodysAsset,
  theTargetCarriesNoPrecondition,
} from "./copilot-target-resolver.maintenance.spec";

/** `F4.281` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.281 — the maintenanceSchedule target mirrors the routes' gate (ADR 0099 Amendment 8 D2)", () => {
  it("resolves each copilot role in scope, asking the role class then the read scope", () => everyCopilotRoleInScopeResolvesTheSchedule());
  it("refuses an operator before the scope is read", () => anOperatorIsRefusedBeforeTheScope());
  it("refuses a viewer before the scope is read", () => aViewerIsRefusedBeforeTheScope());
  it("refuses a schedule whose asset is outside the read scope", () => aScheduleOutsideTheReadScopeIsRefused());
  it("resolves a global admin on any schedule", () => aGlobalAdminResolvesAnySchedule());
  it("resolves a create on the body's asset", () => theCreateResolvesTheBodysAsset());
  it("refuses a create in no allowed organization", () => aCreateInNoAllowedOrganizationIsRefused());
  it("carries no precondition (D6)", () => theTargetCarriesNoPrecondition());
});
