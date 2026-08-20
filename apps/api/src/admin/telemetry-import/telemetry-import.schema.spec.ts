import { MAX_IMPORT_FILE_BYTES, telemetryImportOptionsBodySchema } from "./telemetry-import.schema";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Coverage for `telemetryImportOptionsBodySchema` and its file-size cap (`F1.9`). */
export function runTelemetryImportSchemaTests(): void {
  // ---- defaults: unmapped source, reject-on-conflict -------------------------

  const defaults = telemetryImportOptionsBodySchema.parse({});
  assert(defaults.sourceKind === "unmapped", `sourceKind must default to 'unmapped', got '${defaults.sourceKind}'`);
  assert(defaults.conflictPolicy === "reject", `conflictPolicy must default to 'reject', got '${defaults.conflictPolicy}'`);

  // ---- an explicit writable sourceKind is accepted ----------------------------

  const manual = telemetryImportOptionsBodySchema.parse({ sourceKind: "manual" });
  assert(manual.sourceKind === "manual", "an explicit writable sourceKind must be accepted");

  // ---- 'measured' is not a writable sourceKind --------------------------------

  const measured = telemetryImportOptionsBodySchema.safeParse({ sourceKind: "measured" });
  assert(!measured.success, "'measured' must be rejected — the API cannot supply the rtu_id it requires");

  // ---- an explicit conflictPolicy of 'overwrite' is accepted ------------------

  const overwrite = telemetryImportOptionsBodySchema.parse({ conflictPolicy: "overwrite" });
  assert(overwrite.conflictPolicy === "overwrite", "an explicit 'overwrite' conflictPolicy must be accepted");

  // ---- an invalid conflictPolicy is rejected ----------------------------------

  const badPolicy = telemetryImportOptionsBodySchema.safeParse({ conflictPolicy: "merge" });
  assert(!badPolicy.success, "an unrecognised conflictPolicy must be rejected");

  // ---- an unknown field is rejected (strict) ----------------------------------

  const unknownField = telemetryImportOptionsBodySchema.safeParse({ sourceKind: "manual", extra: "nope" });
  assert(!unknownField.success, "an unrecognised body field must be rejected");

  // ---- the file-size cap is the plan's decided 5 MiB tunable ------------------

  assert(MAX_IMPORT_FILE_BYTES === 5 * 1024 * 1024, `MAX_IMPORT_FILE_BYTES must be 5 MiB, got ${MAX_IMPORT_FILE_BYTES}`);
}
