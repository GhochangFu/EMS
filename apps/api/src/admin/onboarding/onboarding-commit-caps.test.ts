import { describe, it } from "vitest";

import {
  assertANullDraftIsStillTheValidationRefusal,
  assertDeduplicationKeepsTheFirstOffender,
  assertDomainCheckIsDeduplicated,
  assertOverCapDraftIsRefusedBeforeValidate,
  assertOverCapDraftStillLosesToTheAccessGate,
} from "./onboarding-commit-caps.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * `onboarding-commit.service.rls.integration.*` is the only other cover this
 * service has, and it self-skips without `DATABASE_URL`. Every case here throws
 * before the transaction opens, so this pair runs on any machine.
 */
describe("onboarding commit count caps (F4.103)", () => {
  it("refuses an over-cap stored draft before validate is asked", async () => {
    await assertOverCapDraftIsRefusedBeforeValidate();
  });

  it("still answers an out-of-scope caller with the access refusal", async () => {
    await assertOverCapDraftStillLosesToTheAccessGate();
  });

  it("checks each distinct plant domain once instead of once per asset", async () => {
    await assertDomainCheckIsDeduplicated();
  });

  it("keeps first-appearance order, so the first unknown domain is the one reported", async () => {
    await assertDeduplicationKeepsTheFirstOffender();
  });

  it("answers a null stored draft with the validation refusal, not a crash", async () => {
    await assertANullDraftIsStillTheValidationRefusal();
  });
});
