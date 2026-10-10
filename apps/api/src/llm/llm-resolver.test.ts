import { describe, it } from "vitest";

import {
  assertACompleteRowBuildsThatProvider,
  assertAnEmptyLlmProviderIsOff,
  assertAnIncompleteRowNeverUsesThePlatformKey,
  assertAnOffRowIsGuidedMode,
  assertEachProviderNeedsItsKey,
  assertNoRowUsesThePlatformDefault,
  assertOffLogsNoWarning,
  assertOpenRouterNeedsAModelAndTheOthersDefault,
  assertTheBootWarningNamesTheVariableAndNoValue,
  assertTheKeyIsNotCached,
} from "./llm-resolver.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("LLM resolver (F3.21, ADR 0090 Amendment 1 A2/A4)", () => {
  it("treats an empty LLM_PROVIDER as off", async () => {
    await assertAnEmptyLlmProviderIsOff();
  });

  it("needs each provider's own key", async () => {
    await assertEachProviderNeedsItsKey();
  });

  it("needs an OpenRouter model and defaults the other two", async () => {
    await assertOpenRouterNeedsAModelAndTheOthersDefault();
  });

  it("warns once at boot, naming the variable and no value", async () => {
    await assertTheBootWarningNamesTheVariableAndNoValue();
  });

  it("logs nothing when the platform is off", async () => {
    await assertOffLogsNoWarning();
  });

  it("uses the platform default when the organization has no row", async () => {
    await assertNoRowUsesThePlatformDefault();
  });

  it("answers an off row with the guided mode", async () => {
    await assertAnOffRowIsGuidedMode();
  });

  it("builds an organization's provider with its own key", async () => {
    await assertACompleteRowBuildsThatProvider();
  });

  it("never uses the platform key for an organization row", async () => {
    await assertAnIncompleteRowNeverUsesThePlatformKey();
  });

  it("decrypts the key on every turn", async () => {
    await assertTheKeyIsNotCached();
  });
});
