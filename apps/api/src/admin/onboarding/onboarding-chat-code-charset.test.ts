import { describe, it } from "vitest";

import {
  assertDerivedCodesCollideOnlyWhereSlugsDo,
  assertAssetsTurnFromAnAllIllegalName,
  assertAssetsTurnKeepsACutCodeInsideTheClass,
  assertAssetsTurnPatchSatisfiesTheSchema,
  assertAssetsTurnReadsTheStoredSlug,
  assertAssetsTurnWithAnEmptySlugDerivesFromTheName,
  assertAssetsTurnSlugifiesBeforeUpperCasing,
  assertAssetsTurnSlugifiesTheLocationName,
} from "./onboarding-chat-code-charset.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("OnboardingChatService.handleTurn, assets branch — the catalog code class (F2.23)", () => {
  it("slugifies the location name to the class before the marker", async () => {
    await assertAssetsTurnSlugifiesTheLocationName();
  });

  it("produces a patch the draft schema accepts, where the pre-row formula's is refused", async () => {
    await assertAssetsTurnPatchSatisfiesTheSchema();
  });

  it("derives the code from the stored slug, not one re-derived from the name (F4.136)", async () => {
    await assertAssetsTurnReadsTheStoredSlug();
  });

  it("derives the code from the location name when the stored slug is empty (F4.136)", async () => {
    await assertAssetsTurnWithAnEmptySlugDerivesFromTheName();
  });

  it("slugifies before it upper-cases, so ß does not fold into SS", async () => {
    await assertAssetsTurnSlugifiesBeforeUpperCasing();
  });

  it("yields the fallback slug's code from a name with nothing inside the class", async () => {
    await assertAssetsTurnFromAnAllIllegalName();
  });

  it("keeps a cut code inside the bound and the class", async () => {
    await assertAssetsTurnKeepsACutCodeInsideTheClass();
  });

  it("derives one code from two names only where they derive one slug (F4.136)", async () => {
    await assertDerivedCodesCollideOnlyWhereSlugsDo();
  });
});
