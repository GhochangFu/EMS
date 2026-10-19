import { describe, it } from "vitest";

import {
  assertMqttCredentialWithControlCharIsRefused,
  runOnboardingCredentialsAsyncTests,
  runOnboardingCredentialsTests,
} from "./onboarding-credentials.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). */
describe("onboarding credentials endpoint (ADR 0022 decision 1)", () => {
  it("validates the request body strictly", () => {
    runOnboardingCredentialsTests();
  });

  it("gates on role, fails closed without a key, and never echoes plaintext", async () => {
    await runOnboardingCredentialsAsyncTests();
  });

  it("refuses a control character in an MQTT RTU's credential (F3.24b, C1)", async () => {
    await assertMqttCredentialWithControlCharIsRefused();
  });
});
