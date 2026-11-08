import { describe, it } from "vitest";

import {
  assertADeclaredKeyCountsBesideCatalogKeys,
  assertAnInactiveCatalogKeyKeepsThePointKeyPhase,
  assertCatalogOnlyMappingsReachReviewAndCommit,
  assertConfirmPointKeysMovesOnForACatalogOnlyDraft,
  assertNoMappingsAndNoKeysStillNeedKeys,
  assertWithoutTheCatalogTheGateFailsClosed,
} from "./onboarding-validate-catalog-keys.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("the point-key gate reads the catalog (F4.339, ADR 0117 decision 4)", () => {
  it("lets mappings to active catalog keys reach review and commit", () => {
    assertCatalogOnlyMappingsReachReviewAndCommit();
  });

  it("keeps the point-key phase for an inactive catalog key", () => {
    assertAnInactiveCatalogKeyKeepsThePointKeyPhase();
  });

  it("still asks for keys with no mappings and no keys", () => {
    assertNoMappingsAndNoKeysStillNeedKeys();
  });

  it("fails closed without the catalog", () => {
    assertWithoutTheCatalogTheGateFailsClosed();
  });

  it("still asks for keys when a mapping names an unknown key", () => {
    assertADeclaredKeyCountsBesideCatalogKeys();
  });

  it('"confirm point keys" moves a catalog-only draft on (guided path)', async () => {
    await assertConfirmPointKeysMovesOnForACatalogOnlyDraft();
  });
});
