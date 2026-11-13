import { describe, it } from "vitest";

import {
  aBadBodyIs400,
  anOperatorAndAViewerAreRefusedEveryWrite,
  theFourAdminRolesWriteWithTheGateFirst,
  theListPassesTheThreeReadableSets,
} from "./maintenance-windows.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.359 — MaintenanceWindowsController (stubbed gate and service)", () => {
  it("refuses an operator and a viewer on each of the four writes before anything else runs", () =>
    anOperatorAndAViewerAreRefusedEveryWrite());
  it("admits the four admin roles, the role gate before the scope", () => theFourAdminRolesWriteWithTheGateFirst());
  it("answers 400 for a bad body or id, and calls no service", () => aBadBodyIs400());
  it("passes the three readable sets to the list", () => theListPassesTheThreeReadableSets());
});
