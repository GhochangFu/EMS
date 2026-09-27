import { describe, it } from "vitest";

import {
  assertActiveStoredCodeIsActive,
  assertPatchLocationWithoutTypeIsNotChecked,
  assertPatchNamingATypeIsChecked,
  assertPatchNamingAnInactiveTypeIsRefused,
  assertPatchWithoutLocationIsNotChecked,
  assertUnknownStoredTypeIsNotActive,
} from "./onboarding-location-type-match.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("hasActiveLocationType (F4.162)", () => {
  it("is false for a stored type that is not an active code", () => {
    assertUnknownStoredTypeIsNotActive();
  });

  it("is true for a stored active code", () => {
    assertActiveStoredCodeIsActive();
  });
});

describe("assertPatchLocationTypeIsActive (F4.162)", () => {
  it("asks the vocabulary once about the type the patch names", async () => {
    await assertPatchNamingATypeIsChecked();
  });

  it("rethrows the vocabulary's refusal", async () => {
    await assertPatchNamingAnInactiveTypeIsRefused();
  });

  it("asks nothing when the patch's location names no type", async () => {
    await assertPatchLocationWithoutTypeIsNotChecked();
  });

  it("asks nothing when the patch has no location", async () => {
    await assertPatchWithoutLocationIsNotChecked();
  });
});
