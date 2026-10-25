import { describe, it } from "vitest";

import {
  aMalformedCreateBodyIsABadRequest,
  aPatchBodyNamingCodeIsABadRequest,
  aValidCreateBodyReachesTheService,
} from "./location-types.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). No database: the service is a stub. */
describe("F4.282 — LocationTypesVocabularyAdminController keeps a shared-schema parse error a 400", () => {
  it("turns a malformed create body into a 400 naming code", () => aMalformedCreateBodyIsABadRequest());
  it("passes a valid create body to the service", () => aValidCreateBodyReachesTheService());
  it("turns a PATCH body naming code into a 400", () => aPatchBodyNamingCodeIsABadRequest());
});
