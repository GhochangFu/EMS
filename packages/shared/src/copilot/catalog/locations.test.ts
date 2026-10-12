import { describe, it } from "vitest";

import {
  aCreateNamesTheRowAndItsPlace,
  aLocationMoveSaysSo,
  theLocationEntriesAreTheControllersRoutes,
  theRtuEntriesAreTheControllersRoutes,
  theStepsAreThePlans,
} from "./locations.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.86 PR 3a — the location and RTU catalog entries", () => {
  it("makes the location entries the controller's routes", () => theLocationEntriesAreTheControllersRoutes());
  it("makes the RTU entries the controller's routes", () => theRtuEntriesAreTheControllersRoutes());
  it("gives each entry the plan's steps", () => theStepsAreThePlans());
  it("says a location update with parentId moves it", () => aLocationMoveSaysSo());
  it("names the new row and its place in a create summary", () => aCreateNamesTheRowAndItsPlace());
});
