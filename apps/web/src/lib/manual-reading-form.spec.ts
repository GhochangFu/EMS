import type { TelemetryWriteResponse } from "@bms/shared";

import {
  buildManualReadingRow,
  defaultLocalDateTime,
  describeWriteOutcome,
  localDateTimeToIso,
  validateManualReadingForm,
  type ManualReadingFormValues,
} from "./manual-reading-form";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `localDateTimeToIso` is the highest-value test in the web half: an
 * `<input type="datetime-local">` emits an offset-less string, and handing
 * that to `new Date()` resolves it against whichever process's local
 * timezone reads it — the same defect class Phase A already fixed in the
 * notify payload. Deterministic given an explicit offset, not the runner's
 * `TZ`.
 */
export function runLocalDateTimeToIsoTests(): void {
  // IST is UTC+5:30, so getTimezoneOffset() there is -330.
  assert(
    localDateTimeToIso("2026-08-20T14:30", -330) === "2026-08-20T09:00:00.000Z",
    `IST 14:30 must convert to 09:00 UTC, got ${localDateTimeToIso("2026-08-20T14:30", -330)}`,
  );
  // A positive offset (west of UTC), e.g. US Eastern standard time (UTC-5, offset +300).
  assert(
    localDateTimeToIso("2026-08-20T09:00", 300) === "2026-08-20T14:00:00.000Z",
    `Eastern 09:00 must convert to 14:00 UTC, got ${localDateTimeToIso("2026-08-20T09:00", 300)}`,
  );
  // UTC itself (offset 0) is a no-op shift.
  assert(
    localDateTimeToIso("2026-08-20T00:00", 0) === "2026-08-20T00:00:00.000Z",
    "an offset of 0 must leave the wall-clock value unchanged",
  );
  // Seconds are accepted when the control includes them.
  assert(
    localDateTimeToIso("2026-08-20T14:30:15", 0) === "2026-08-20T14:30:15.000Z",
    "a value with seconds must parse",
  );

  let threw = false;
  try {
    localDateTimeToIso("not-a-datetime", 0);
  } catch {
    threw = true;
  }
  assert(threw, "malformed input must throw rather than silently producing an invalid instant");

  let threwOnEmpty = false;
  try {
    localDateTimeToIso("", 0);
  } catch {
    threwOnEmpty = true;
  }
  assert(threwOnEmpty, "an empty string must throw");
}

export function runDefaultLocalDateTimeTests(): void {
  // The local Date constructor interprets its arguments as local-time
  // components regardless of the runner's TZ, so this is deterministic.
  const now = new Date(2026, 7, 20, 14, 5);
  assert(
    defaultLocalDateTime(now) === "2026-08-20T14:05",
    `expected "2026-08-20T14:05", got "${defaultLocalDateTime(now)}"`,
  );

  const midnightSingleDigits = new Date(2026, 0, 5, 9, 3);
  assert(
    defaultLocalDateTime(midnightSingleDigits) === "2026-01-05T09:03",
    `month/day/hour/minute must be zero-padded, got "${defaultLocalDateTime(midnightSingleDigits)}"`,
  );
}

const BASE_FORM: ManualReadingFormValues = {
  assetId: "00000000-0000-4000-8000-000000000001",
  pointKey: "kw",
  value: "12.5",
  unit: "kW",
  time: "2026-08-20T14:30",
};

export function runBuildManualReadingRowTests(): void {
  const withCatalogUnit = buildManualReadingRow(BASE_FORM, "kW", 0);
  assert(
    withCatalogUnit.unit === undefined,
    `unit must be omitted when it matches the catalog default, got ${JSON.stringify(withCatalogUnit.unit)}`,
  );
  assert(withCatalogUnit.time === "2026-08-20T14:30:00.000Z", "time must be converted using the given offset");
  assert(withCatalogUnit.value === 12.5, "value must be parsed to a number");
  assert(
    withCatalogUnit.assetId === BASE_FORM.assetId && withCatalogUnit.pointKey === BASE_FORM.pointKey,
    "assetId and pointKey must pass through unchanged",
  );

  const withOverriddenUnit = buildManualReadingRow({ ...BASE_FORM, unit: "MW" }, "kW", 0);
  assert(
    withOverriddenUnit.unit === "MW",
    `unit must be sent when the operator edited it away from the catalog default, got ${JSON.stringify(withOverriddenUnit.unit)}`,
  );

  const withNoCatalogUnit = buildManualReadingRow(BASE_FORM, null, 0);
  assert(
    withNoCatalogUnit.unit === "kW",
    "when there is no catalog default at all, the operator's own unit must always be sent",
  );
}

function response(overrides: Partial<TelemetryWriteResponse["result"]>, rejectedCount = 0): TelemetryWriteResponse {
  return {
    result: {
      written: 0,
      skipped: 0,
      assetPointsCreated: 0,
      firstTime: null,
      lastTime: null,
      batchId: "00000000-0000-4000-8000-000000000001",
      ...overrides,
    },
    rejected: Array.from({ length: rejectedCount }, (_, i) => ({
      rowNumber: i + 1,
      field: null,
      reason: "rejected",
    })),
  };
}

export function runDescribeWriteOutcomeTests(): void {
  const nothingWritten = describeWriteOutcome(response({ written: 0 }, 2));
  assert(
    /no reading/i.test(nothingWritten),
    `an all-rejected outcome must say nothing was written, got "${nothingWritten}"`,
  );
  assert(
    !/success/i.test(nothingWritten),
    `must never claim success when written is 0, got "${nothingWritten}"`,
  );

  const singleWrite = describeWriteOutcome(response({ written: 1 }));
  assert(/1 reading/i.test(singleWrite), `must mention the written count, got "${singleWrite}"`);
  assert(!/mapping/i.test(singleWrite), "must not mention mapping creation when none happened");

  const withMapping = describeWriteOutcome(response({ written: 1, assetPointsCreated: 1 }));
  assert(/mapping/i.test(withMapping), `must mention mapping creation when it happened, got "${withMapping}"`);

  const partial = describeWriteOutcome(response({ written: 1 }, 1));
  assert(/1 reading/i.test(partial) && /1.*reject/i.test(partial), `must mention both written and rejected counts, got "${partial}"`);
}

export function runValidateManualReadingFormTests(): void {
  const errors = validateManualReadingForm(BASE_FORM);
  assert(Object.keys(errors).length === 0, `a well-formed form must have no errors, got ${JSON.stringify(errors)}`);

  const missingAsset = validateManualReadingForm({ ...BASE_FORM, assetId: "" });
  assert(typeof missingAsset.assetId === "string", "a missing assetId must produce an error");

  const missingPointKey = validateManualReadingForm({ ...BASE_FORM, pointKey: "" });
  assert(typeof missingPointKey.pointKey === "string", "a missing pointKey must produce an error");

  const badValue = validateManualReadingForm({ ...BASE_FORM, value: "not-a-number" });
  assert(typeof badValue.value === "string", "an unparseable value must produce an error");

  const emptyValue = validateManualReadingForm({ ...BASE_FORM, value: "" });
  assert(typeof emptyValue.value === "string", "an empty value must produce an error");

  const badTime = validateManualReadingForm({ ...BASE_FORM, time: "not-a-time" });
  assert(typeof badTime.time === "string", "an unparseable time must produce an error");

  // Semantic rules (retention horizon, catalog membership, unit agreement)
  // are deliberately NOT re-implemented here — those stay server-owned.
  const futureButFormatValid = validateManualReadingForm({ ...BASE_FORM, time: "2099-01-01T00:00" });
  assert(
    Object.keys(futureButFormatValid).length === 0,
    "a future timestamp must not be rejected client-side — only the server owns skew rules",
  );
}
