import { describe, it } from "vitest";

import {
  assertTheSeedWritesOneRowForTheGivenOrganization,
  assertTheSwitchIsInsertedIfAbsentAndNeverUpdated,
} from "./copilot-demo-seed.spec";

describe("F3.85 — the demo organization's copilot switch (plan Q5)", () => {
  it("inserts the switch if absent and never updates it", () => {
    assertTheSwitchIsInsertedIfAbsentAndNeverUpdated();
  });

  it("writes one row for the given organization", async () => {
    await assertTheSeedWritesOneRowForTheGivenOrganization();
  });
});
