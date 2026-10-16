import { describe, it } from "vitest";

import { noOtherHandlerIsMarked, theRouteStageFollowsMulter, theUploadHandlerIsMarked } from "./mimic-symbol-upload-route.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.87 PR 6a — the symbol upload is the copilot's multipart Confirm target (ADR 0099 Amendment 3 A3)", () => {
  it("marks the upload handler", () => theUploadHandlerIsMarked());
  it("runs the route stage after multer", () => theRouteStageFollowsMulter());
  it("marks no other handler", () => noOtherHandlerIsMarked());
});
