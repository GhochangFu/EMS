import { describe, it } from "vitest";

import {
  assertAssetCreateAndUpdateCodeClass,
  assertDraftAssetCodeClass,
  assertDraftPointKeyCodeClass,
  assertInstantiateAssetCodeClass,
  assertPointKeyCreateCodeClass,
  assertValidateNamesTheField,
} from "./catalog-code-charset.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("catalog code character class at the five Zod sites (F2.23, ADR 0065 decision 1)", () => {
  it("createAssetBodySchema and updateAssetBodySchema refuse a code outside the class at [code]", () => {
    assertAssetCreateAndUpdateCodeClass();
  });

  it("instantiateAssetsBodySchema refuses a code outside the class at [assets, 0, code]", () => {
    assertInstantiateAssetCodeClass();
  });

  it("createPointKeyBodySchema refuses a code outside the class at [code]", () => {
    assertPointKeyCreateCodeClass();
  });

  it("draftAssetSchema refuses a code outside the class at [code]", () => {
    assertDraftAssetCodeClass();
  });

  it("draftPointKeySchema refuses a code outside the class at [code]", () => {
    assertDraftPointKeyCodeClass();
  });

  it("OnboardingValidateService.validate names assets.0.code and pointKeys.0.code and is not ready to commit", () => {
    assertValidateNamesTheField();
  });
});
