import type { Measured, Strict } from "@bms/shared";
import { telemetryWriteResponseSchema } from "@bms/shared";
import type { z } from "zod";

import type { WriteReadingsOutput } from "./telemetry-write.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Behavioural cover for the F1.8/F1.9 write-response envelope
 * (`packages/shared/src/contracts/telemetry-entry.ts`,
 * `telemetryWriteResponseSchema`).
 *
 * The controller returns the full `WriteReadingsOutput` shape from
 * `telemetry-write.service.ts` — `{ result, rejected }` — not just the
 * `TelemetryWriteResultDto` alone. This proves the schema's `z.infer` is
 * structurally identical to that frozen service type, and that it parses the
 * shapes the controller actually produces.
 */
export function runManualReadingsSchemaTests(): void {
  // ---- type-level: the schema's inferred type must match the service's
  // ---- output type exactly, not just be mutually assignable.
  type _EnvelopeMatchesServiceOutput = Measured<
    Strict<z.infer<typeof telemetryWriteResponseSchema>, WriteReadingsOutput>
  >;
  const _envelopeMatchesServiceOutput: _EnvelopeMatchesServiceOutput = true;
  void _envelopeMatchesServiceOutput;

  // ---- runtime: a full payload must parse -----------------------------------

  const fullPayload = {
    result: {
      written: 3,
      skipped: 1,
      assetPointsCreated: 0,
      firstTime: "2026-08-19T12:00:00.000Z",
      lastTime: "2026-08-19T12:05:00.000Z",
      batchId: "00000000-0000-4000-8000-000000000001",
    },
    rejected: [{ rowNumber: 2, field: "value", reason: "not finite" }],
  };
  const parsed = telemetryWriteResponseSchema.safeParse(fullPayload);
  assert(parsed.success, `a well-formed envelope must parse: ${JSON.stringify(parsed)}`);

  // ---- runtime: a payload missing `rejected` must fail -----------------------

  const { rejected: _omitted, ...missingRejected } = fullPayload;
  assert(
    !telemetryWriteResponseSchema.safeParse(missingRejected).success,
    "an envelope missing `rejected` must fail — the controller always returns both fields",
  );

  // ---- runtime: `field` nullability must survive the envelope ---------------

  const withNullField = {
    ...fullPayload,
    rejected: [{ rowNumber: 5, field: null, reason: "unknown asset" }],
  };
  assert(
    telemetryWriteResponseSchema.safeParse(withNullField).success,
    "a rejected row with field: null must parse — a row-level rejection is not always attributable to one field",
  );
}
