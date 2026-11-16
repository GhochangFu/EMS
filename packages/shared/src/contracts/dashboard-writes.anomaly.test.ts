import { describe, it } from "vitest";

import {
  acceptsAAnomalyWithOnePoint,
  refusesAAnomalyConfigKey,
  refusesAAnomalyWithoutExactlyOnePoint,
} from "./dashboard-writes.anomaly.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.2d — the anomaly widget write arm (ADR 0135 Amendment 5 ruling 4(c))", () => {
  it("has a write arm, last, and accepts a anomaly with one point", () => {
    acceptsAAnomalyWithOnePoint();
  });

  it("refuses no point, two points, and a source", () => {
    refusesAAnomalyWithoutExactlyOnePoint();
  });

  it("refuses any config key", () => {
    refusesAAnomalyConfigKey();
  });
});
