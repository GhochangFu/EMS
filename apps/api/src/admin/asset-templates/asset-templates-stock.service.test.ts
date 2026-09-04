import { describe, it } from "vitest";

import {
  assertASchemaFailingEntryIsRefusedBeforeCreate,
  assertAValidEntryReachesCreateWithTheParsedBodyAndTheStamp,
  assertTheControllerAnswers400WithTheSchemasOwnMessage,
} from "./asset-templates-stock.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.16 — the stock import runs the create body schema before create", () => {
  it("refuses a schema-failing entry with a ZodError, before create, after authorization", async () => {
    await assertASchemaFailingEntryIsRefusedBeforeCreate();
  });

  it("answers 400 with the schema's own message, not a generic Bad Request Exception", async () => {
    await assertTheControllerAnswers400WithTheSchemasOwnMessage();
  });

  it("reaches create with the parsed body and the stamp for a valid entry", async () => {
    await assertAValidEntryReachesCreateWithTheParsedBodyAndTheStamp();
  });
});
