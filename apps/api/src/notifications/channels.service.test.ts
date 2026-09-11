import { describe, it } from "vitest";

import {
  runChannelNullKeyVersionTests,
  runChannelStoredKeyVersionTests,
  runChannelVersionRefusalTests,
  runChannelsServiceTests,
} from "./channels.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.8 channels service", () => {
  it("answers constraint violations with 409/400 and keeps readiness honest", async () => {
    await runChannelsServiceTests();
  });
});

/**
 * `E8.4` — one `it()` per claim. `assert` throws, so two claims sharing an
 * `it()` would leave the second unable to redden on its own mutation.
 */
describe("E8.4 channel secrets decrypt at their stored version", () => {
  it("passes the stored key version to decrypt", () => {
    runChannelStoredKeyVersionTests();
  });

  it("passes a null stored key version through undefaulted", () => {
    runChannelNullKeyVersionTests();
  });

  it("contains a refused key version and warns with the class name only", () => {
    runChannelVersionRefusalTests();
  });
});
