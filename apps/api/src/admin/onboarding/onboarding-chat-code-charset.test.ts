import { describe, it } from "vitest";

import {
  assertAnAssetCodeCollisionIsAlreadyASlugCollision,
  assertAssetsTurnFromAnAllIllegalName,
  assertAssetsTurnKeepsACutCodeInsideTheClass,
  assertAssetsTurnPatchSatisfiesTheSchema,
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

  it("slugifies before it upper-cases, so ß does not fold into SS", async () => {
    await assertAssetsTurnSlugifiesBeforeUpperCasing();
  });

  it("yields the marker alone from a name with nothing inside the class", async () => {
    await assertAssetsTurnFromAnAllIllegalName();
  });

  it("keeps a cut code inside the bound and the class", async () => {
    await assertAssetsTurnKeepsACutCodeInsideTheClass();
  });

  it("never collides two tenants on an asset code without colliding them on the slug first", async () => {
    await assertAnAssetCodeCollisionIsAlreadyASlugCollision();
  });
});
