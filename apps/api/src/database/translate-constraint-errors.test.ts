import { describe, it } from "vitest";

import * as spec from "./translate-constraint-errors.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.78 — translateConstraintErrors (shared by channels, grants, asset groups)", () => {
  it("a unique violation becomes the caller's conflict", async () => {
    await spec.assertAUniqueViolationIsTheCallersConflict();
  });

  it("a foreign-key violation becomes the caller's answer", async () => {
    await spec.assertAForeignKeyViolationIsTheCallersAnswer();
  });

  it("the foreign-key handler sees the raw error", async () => {
    await spec.assertTheForeignKeyHandlerSeesTheRawError();
  });

  it("any other SQLSTATE, 42501 included, is rethrown unchanged", async () => {
    await spec.assertAnyOtherCodeIsRethrownUnchanged();
  });

  it("a foreign-key violation with no handler is rethrown", async () => {
    await spec.assertAnUnhandledForeignKeyViolationIsRethrown();
  });

  it("a successful run returns its value", async () => {
    await spec.assertASuccessfulRunReturnsItsValue();
  });
});
