// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  fiveMembersKeepTheDenseRows,
  theCodeIsClippedShortOfTheSwitch,
  twoMembersDrawRoomyRowsWithTheTrainNumber,
} from "./mimic-scene.member-rows.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F4.322 — MimicScene, the fan-out member rows", () => {
  afterEach(() => {
    cleanup();
  });

  it("R1 two members draw roomy rows; the code keeps its train number", () => {
    twoMembersDrawRoomyRowsWithTheTrainNumber();
  });
  it("R2 five members keep the dense rows", () => {
    fiveMembersKeepTheDenseRows();
  });
  it("R3 the code is clipped short of the switch or the pill", () => {
    theCodeIsClippedShortOfTheSwitch();
  });
});
