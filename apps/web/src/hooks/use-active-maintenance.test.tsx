// @vitest-environment jsdom
import { describe, it } from "vitest";

import {
  anEmptyListGivesAnEmptySet,
  theRequestCarriesStateAndScope,
  twoWindowsUnionIntoTheSet,
} from "./use-active-maintenance.spec";

/** `F4.359` U11 — `useActiveMaintenance`. */
describe("F4.359 — useActiveMaintenance", () => {
  it("unions the covered asset ids of the active windows", async () => {
    await twoWindowsUnionIntoTheSet();
  });
  it("gives an empty set for an empty list", async () => {
    await anEmptyListGivesAnEmptySet();
  });
  it("sends state=active and the scope", async () => {
    await theRequestCarriesStateAndScope();
  });
});
