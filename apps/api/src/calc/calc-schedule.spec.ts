import { bucketTimeMs, isDue } from "./calc-schedule";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export function runCalcScheduleTests(): void {
  // ---- bucketTimeMs truncates on absolute epoch boundaries -------------------

  const t = Date.parse("2026-08-20T12:34:56.789Z");
  const bucketed60 = bucketTimeMs(t, 60);
  assert(
    bucketed60 === Date.parse("2026-08-20T12:34:00.000Z"),
    `a 60s bucket must truncate to the minute, got ${new Date(bucketed60).toISOString()}`,
  );

  // Two different instants inside the same bucket must produce the identical
  // timestamp — this is the idempotency assertion ADR 0037 decision 8 exists
  // for, and it is the one worth writing.
  const a = bucketTimeMs(Date.parse("2026-08-20T12:34:00.001Z"), 60);
  const b = bucketTimeMs(Date.parse("2026-08-20T12:34:59.999Z"), 60);
  assert(a === b, "two instants inside one 60s bucket must produce the identical output time");

  // A 3600s (1h) interval must truncate on the absolute epoch hour regardless
  // of the process's local timezone — set here to a half-hour-offset zone
  // (Asia/Kolkata, UTC+5:30) so a local-time bug (reading Date components in
  // local time instead of doing epoch-ms arithmetic) cannot pass silently.
  const originalTz = process.env.TZ;
  process.env.TZ = "Asia/Kolkata";
  try {
    const hourly = bucketTimeMs(Date.parse("2026-08-20T12:34:56.000Z"), 3600);
    assert(
      hourly === Date.parse("2026-08-20T12:00:00.000Z"),
      `a 3600s bucket under a half-hour-offset TZ must still truncate to the UTC hour, got ${new Date(hourly).toISOString()}`,
    );
  } finally {
    process.env.TZ = originalTz;
  }

  // ---- isDue ------------------------------------------------------------------

  assert(isDue({ intervalSeconds: 60, lastRunMs: null, nowMs: 0 }), "never run before must always be due");
  assert(
    !isDue({ intervalSeconds: 60, lastRunMs: 1000, nowMs: 1000 + 59_000 }),
    "59s after a 60s interval's last run must not be due yet",
  );
  assert(
    isDue({ intervalSeconds: 60, lastRunMs: 1000, nowMs: 1000 + 60_000 }),
    "exactly 60s after a 60s interval's last run must be due",
  );
}
