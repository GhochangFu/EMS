import { describe, it } from "vitest";

import {
  runABadBodyIsRefused,
  runABooleanBodyPasses,
  runTheResponsesRequireTheSwitch,
} from "./organization-ingest.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.330 — organization ingest contracts (ADR 0115)", () => {
  it("G1 — a boolean body passes", () => {
    runABooleanBodyPasses();
  });

  it("G2 — a string, an empty or an extra-key body is refused", () => {
    runABadBodyIsRefused();
  });

  it("G3 — the organization, summary and RTU responses require the switch", () => {
    runTheResponsesRequireTheSwitch();
  });
});
