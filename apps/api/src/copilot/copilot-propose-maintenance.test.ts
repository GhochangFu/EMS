import { describe, it } from "vitest";

import {
  theActivateStoresActiveTrue,
  theCreateStoresTheRawBody,
  theDeactivateRefusesTheOtherDirection,
  theDeactivateStoresItsBody,
  theToolsAreOfferedToAnAssetGroupAdmin,
} from "./copilot-propose-maintenance.spec";

/** `F4.281` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.281 — the maintenance-schedule propose tools (ADR 0099 Amendment 8)", () => {
  it("the deactivate stores active false and its reason, red, with no precondition", () => theDeactivateStoresItsBody());
  it("the deactivate refuses active true", () => theDeactivateRefusesTheOtherDirection());
  it("the activate stores active true as an edit", () => theActivateStoresActiveTrue());
  it("the create stores the raw body and names the asset and organization", () => theCreateStoresTheRawBody());
  it("the three tools are offered to an asset_group_admin (Q15)", () => theToolsAreOfferedToAnAssetGroupAdmin());
});
