import { describe, it } from "vitest";

import * as spec from "./mimic-symbol-libraries.controller.spec";

/** `F3.32f` slice 3 U2 — Vitest entry point for the mimic symbol library controller. Assertions live
 * in the sibling `.spec` (ADR 0014); one `it()` per claim. */
describe("F3.32f — MimicSymbolLibrariesController (source scan)", () => {
  it("spells the upload interceptor once, with the four limits", () =>
    spec.assertTheInterceptorIsSpelledOnceWithTheFourLimits());
  it("checks access before requireFile", () => spec.assertUploadChecksAccessBeforeRequireFile());
  it("checks access before the service's upload", () => spec.assertUploadChecksAccessBeforeTheService());
  it("parses the path id before the access gate", () => spec.assertUploadParsesThePathBeforeTheGate());
  it("decodes the filename before parsing it", () => spec.assertUploadDecodesTheFilenameBeforeParsingIt());
  it("is guarded by JwtAuthGuard", () => spec.assertControllerIsGuardedByJwt());
  it("declares PUT settings/:libraryCode before the :id routes", () =>
    spec.assertSettingsRouteIsDeclaredBeforeTheIdRoutes());
  it("declares no request schema inline", () => spec.assertNoRequestSchemaIsDeclaredInTheController());
});

describe("F3.32f — MimicSymbolLibrariesController (behaviour over a stub)", () => {
  it("a denied caller with no file is a 403, not a 400, and the service never uploads", () =>
    spec.assertADeniedCallerWithNoFileIs403NotA400());
  it("an allowed caller with no file is a 400 after the gate", () => spec.assertAnAllowedCallerWithNoFileIs400());
  it("an allowed upload reaches the service with the decoded name and blank fields dropped", () =>
    spec.assertAnAllowedUploadReachesTheServiceWithTheDecodedName());
});
