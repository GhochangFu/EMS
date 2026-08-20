import { chunkForNotify, MAX_NOTIFY_UTF8_BYTES, type NotifyReading } from "./notify-chunk";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function reading(overrides: Partial<NotifyReading> = {}): NotifyReading {
  return {
    time: "2026-08-20T12:00:00.000Z",
    assetId: "00000000-0000-4000-8000-000000000001",
    pointKey: "kw",
    value: 42,
    unit: "kW",
    ...overrides,
  };
}

function payloadBytes(chunk: readonly NotifyReading[]): number {
  return Buffer.byteLength(JSON.stringify({ readings: chunk }), "utf8");
}

/** Coverage for `chunkForNotify` (F1.8/F1.9) — this module had none before. */
export function runNotifyChunkTests(): void {
  // ---- empty input yields no chunks -----------------------------------------

  assert(chunkForNotify([]).length === 0, "no readings must produce no chunks");

  // ---- a small batch fits in one chunk under the real default cap -----------

  const small = [reading({ pointKey: "kw" }), reading({ pointKey: "kwh" })];
  const singleChunk = chunkForNotify(small);
  assert(singleChunk.length === 1, `a small batch must fit in one chunk, got ${singleChunk.length}`);
  assert(singleChunk[0]?.length === 2, "the one chunk must carry both readings");

  // ---- every reading is preserved, none duplicated, order kept within each --

  const many = Array.from({ length: 40 }, (_, i) =>
    reading({ pointKey: `point_key_${i}`, value: i }),
  );
  const chunked = chunkForNotify(many, 400);
  assert(chunked.length > 1, "a small maxBytes must force more than one chunk");
  const flattened = chunked.flat();
  assert(
    flattened.length === many.length,
    `every reading must appear exactly once across chunks, got ${flattened.length} of ${many.length}`,
  );
  assert(
    flattened.every((r, i) => r.pointKey === many[i]?.pointKey),
    "readings must stay in their original order across chunk boundaries",
  );

  // ---- every produced chunk actually fits under the byte cap it was given ---

  for (const chunk of chunked) {
    assert(
      payloadBytes(chunk) <= 400,
      `every chunk must serialise under the requested maxBytes, one measured ${payloadBytes(chunk)}`,
    );
  }

  // ---- a single oversized reading still gets its own chunk, never dropped ---
  // (Unreachable at the real call site under telemetryEntryRowSchema's field
  // caps — exercised here only to prove the function itself never silently
  // drops a reading it cannot shrink further, for any maxBytes a caller
  // supplies.)

  const oversized = reading({ pointKey: "p".repeat(128) });
  const forcedTiny = chunkForNotify([oversized], 10);
  assert(
    forcedTiny.length === 1 && forcedTiny[0]?.length === 1,
    `a reading that cannot fit even alone must still get its own chunk, got ${JSON.stringify(forcedTiny)}`,
  );
  assert(forcedTiny[0]?.[0]?.pointKey === oversized.pointKey, "the oversized reading itself must not be dropped");

  // ---- the real default cap is well clear of a single reading's real size --

  const realistic = reading({
    pointKey: "p".repeat(128),
    unit: "u".repeat(32),
  });
  assert(
    payloadBytes([realistic]) < MAX_NOTIFY_UTF8_BYTES,
    "even a reading at every schema field's maximum length must fit MAX_NOTIFY_UTF8_BYTES alone",
  );

  // ---- chunking respects the DEFAULT cap when none is supplied --------------

  const atDefault = chunkForNotify(many);
  assert(atDefault.length === 1, "40 ordinary readings must fit in one chunk under the real default cap");
}
