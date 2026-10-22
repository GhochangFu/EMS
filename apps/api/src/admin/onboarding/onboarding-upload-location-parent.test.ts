import { describe, it } from "vitest";

import {
  assertAnActiveParentCodeIsNoUploadError,
  assertAnInactiveParentCodeIsTheUploadsFieldError,
  assertAnUnknownParentCodeIsTheUploadsFieldError,
} from "./onboarding-upload-location-parent.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.243 review #4 — the upload response carries the parent field error (ADR 0098 Amendment 2, B8)", () => {
  it("U-P1 answers an unknown parent_code with the not-found field error", async () => {
    await assertAnUnknownParentCodeIsTheUploadsFieldError();
  });
  it("U-P2 answers an inactive parent_code with the inactive field error", async () => {
    await assertAnInactiveParentCodeIsTheUploadsFieldError();
  });
  it("U-P3 answers an active parent_code with no field error", async () => {
    await assertAnActiveParentCodeIsNoUploadError();
  });
});
