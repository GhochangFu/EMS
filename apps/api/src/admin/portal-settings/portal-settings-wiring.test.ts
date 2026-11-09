import { describe, it } from "vitest";

import {
  thePublicControllerHasNoGuardAndOneRoute,
  thePublicReadIsTwoKeys,
  theModuleWiresTheThreeControllers,
  theWriteControllersAreGuarded,
} from "./portal-settings-wiring.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.341 the appearance routes' wiring", () => {
  it("W1 the module wires the three controllers and the service", () => {
    theModuleWiresTheThreeControllers();
  });

  it("W2 the public controller carries no guard and holds exactly GET public/appearance", () => {
    thePublicControllerHasNoGuardAndOneRoute();
  });

  it("W3 the portal and me controllers carry JwtAuthGuard and only their routes", () => {
    theWriteControllersAreGuarded();
  });

  it("W4 the public read answers two keys", async () => {
    await thePublicReadIsTwoKeys();
  });
});
