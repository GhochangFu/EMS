import { chunkReadings, MAX_NOTIFY_UTF8_BYTES, type NotifyReading } from "./chunk.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `chunkReadings()` exactly as the ADR 0007 pilot implemented it, transcribed
 * rather than paraphrased. That file (`apps/ingest/src/index.js`) was deleted at
 * ADR 0016 §6 commit 4; this transcription is now the only record of the
 * behaviour, which is why it must not be "tidied".
 *
 * This is the oracle. The host's version is a rewrite that trades O(n²)
 * `JSON.stringify` calls for incremental byte accounting, and it runs in front
 * of the live PHE pilot during the parallel-run window (ADR 0016 §6, commit 3).
 * A rewrite that is only *argued* to be equivalent is not equivalent; the
 * differential test below is what makes the argument checkable.
 *
 * Do not "clean this up". Its inefficiency and its odd empty-`cur` branch are
 * the specification.
 *
 * **One substitution from the original:** `MAX_NOTIFY_UTF8_BYTES` becomes a
 * parameter. That is not cosmetic — it is what gives the differential test its
 * resolution. See `runChunkReadingsTests`.
 */
function legacyChunkReadings(
  readings: readonly NotifyReading[],
  maxBytes: number = MAX_NOTIFY_UTF8_BYTES,
): NotifyReading[][] {
  const chunks: NotifyReading[][] = [];
  let cur: NotifyReading[] = [];
  for (const r of readings) {
    const trial = cur.length === 0 ? [r] : [...cur, r];
    const json = JSON.stringify({ readings: trial });
    if (Buffer.byteLength(json, "utf8") > maxBytes && cur.length > 0) {
      chunks.push(cur);
      cur = [r];
    } else if (Buffer.byteLength(json, "utf8") > maxBytes) {
      chunks.push([r]);
      cur = [];
    } else {
      cur = trial;
    }
  }
  if (cur.length > 0) {
    chunks.push(cur);
  }
  return chunks;
}

/** Deterministic LCG, so a differential failure reproduces from the seed alone. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const UNITS = [null, "kW", "°C", "m³/h", "µS/cm", "mg/L"] as const;

function makeReading(rand: () => number, index: number): NotifyReading {
  const unit = UNITS[Math.floor(rand() * UNITS.length)] ?? null;
  return {
    time: new Date(Date.UTC(2026, 7, 5, 0, 0, index % 60)).toISOString(),
    assetId: `aaaaaaaa-0000-4000-8000-${String(index).padStart(12, "0")}`,
    pointKey: `POINT_${index}`,
    value: Math.round(rand() * 1e6) / 100,
    unit,
  };
}

function serialisedBytes(chunk: readonly NotifyReading[]): number {
  return Buffer.byteLength(JSON.stringify({ readings: chunk }), "utf8");
}

function describeChunks(chunks: readonly NotifyReading[][]): string {
  return JSON.stringify(chunks.map((c) => c.map((r) => r.pointKey)));
}

/** The single deduplicated NOTIFY chunker (ADR 0016 §2). */
export function runChunkReadingsTests(): void {
  // ---- differential: identical boundaries to the legacy implementation ------

  // **Why the cap is swept rather than fixed.** A reading serialises to ~115
  // bytes, so accumulated totals advance in ~115-byte steps. Against a fixed
  // 7000-byte cap a one-byte accounting error — a miscounted envelope, a
  // miscounted separator comma, `<` where `<=` belongs — changes no boundary at
  // all, because no chunk happens to land within one byte of the cap. Verified:
  // the first version of this test fixed the cap at 7000 and passed all three
  // of those mutations.
  //
  // Sweeping a contiguous range of caps removes the coincidence. For any
  // reading set, some cap in the range equals a chunk's exact byte total, and
  // that is precisely where an off-by-one becomes a different split. The range
  // is dense (step 1) for the same reason.
  for (const seed of [1, 7, 4242]) {
    for (const size of [0, 1, 2, 3, 8, 25]) {
      const rand = makeRandom(seed);
      const readings = Array.from({ length: size }, (_unused, i) => makeReading(rand, i));
      for (let cap = 100; cap <= 700; cap += 1) {
        const mine = chunkReadings(readings, cap);
        const legacy = legacyChunkReadings(readings, cap);
        assert(
          describeChunks(mine) === describeChunks(legacy),
          `chunk boundaries diverged from index.js at seed ${seed}, size ${size}, cap ${cap}:\n` +
            `  host:   ${describeChunks(mine)}\n  legacy: ${describeChunks(legacy)}`,
        );
      }
    }
  }

  // The production cap itself, at sizes that straddle its ~60-reading capacity.
  for (const seed of [1, 7, 4242]) {
    for (const size of [0, 1, 2, 59, 60, 61, 120, 121, 500]) {
      const rand = makeRandom(seed);
      const readings = Array.from({ length: size }, (_unused, i) => makeReading(rand, i));
      assert(
        describeChunks(chunkReadings(readings)) === describeChunks(legacyChunkReadings(readings)),
        `chunk boundaries diverged from index.js at the production cap, seed ${seed}, size ${size}`,
      );
    }
  }

  // ---- the byte identity the rewrite rests on ------------------------------

  // ENVELOPE_BYTES + Σ bytes(item) + (count − 1) must equal what
  // `JSON.stringify` actually produces, or the incremental accounting is
  // measuring something other than the payload Postgres receives.
  {
    const rand = makeRandom(99);
    const readings = Array.from({ length: 400 }, (_unused, i) => makeReading(rand, i));
    for (const chunk of chunkReadings(readings)) {
      const summed =
        15 + chunk.reduce((n, r) => n + Buffer.byteLength(JSON.stringify(r), "utf8"), 0) +
        (chunk.length - 1);
      assert(
        summed === serialisedBytes(chunk),
        `byte identity broken: computed ${summed}, actual ${serialisedBytes(chunk)}`,
      );
    }
  }

  // ---- every chunk fits, except a single reading that cannot --------------

  {
    const rand = makeRandom(5);
    const readings = Array.from({ length: 300 }, (_unused, i) => makeReading(rand, i));
    for (const chunk of chunkReadings(readings)) {
      assert(
        serialisedBytes(chunk) <= MAX_NOTIFY_UTF8_BYTES,
        `chunk of ${chunk.length} readings is ${serialisedBytes(chunk)} bytes, over the cap`,
      );
    }
  }

  // ---- edge: empty input ---------------------------------------------------

  assert(chunkReadings([]).length === 0, "an empty reading list must produce no chunks");

  // ---- edge: one reading larger than the cap, alone ------------------------

  // It is emitted rather than dropped — `index.js` does the same, and silently
  // losing a reading is worse than a NOTIFY Postgres rejects loudly.
  {
    const huge: NotifyReading = {
      time: "2026-08-05T00:00:00.000Z",
      assetId: "a".repeat(9000),
      pointKey: "HUGE",
      value: 1,
      unit: null,
    };
    const chunks = chunkReadings([huge]);
    assert(chunks.length === 1 && chunks[0].length === 1, "an oversized reading must be emitted alone");
    assert(
      describeChunks(chunks) === describeChunks(legacyChunkReadings([huge])),
      "oversized-reading handling must match index.js",
    );
  }

  // ---- edge: oversized reading surrounded by normal ones -------------------

  // The branch where `cur` is non-empty *and* the incoming reading does not fit
  // on its own. Legacy closes `cur`, starts `[r]`, then closes `[r]` on the next
  // iteration — so the oversized reading lands in a chunk by itself.
  {
    const rand = makeRandom(11);
    const huge: NotifyReading = {
      time: "2026-08-05T00:00:00.000Z",
      assetId: "b".repeat(9000),
      pointKey: "HUGE",
      value: 2,
      unit: "kW",
    };
    const readings = [makeReading(rand, 1), makeReading(rand, 2), huge, makeReading(rand, 3)];
    assert(
      describeChunks(chunkReadings(readings)) === describeChunks(legacyChunkReadings(readings)),
      "an oversized reading between normal ones must split exactly as index.js does",
    );
  }

  // ---- edge: multi-byte units are measured in bytes, not code units --------

  // `°C` and `µS/cm` are two bytes per symbol in UTF-8. Measuring `.length`
  // would under-count and produce payloads over the Postgres limit.
  {
    const wide: NotifyReading[] = Array.from({ length: 200 }, (_unused, i) => ({
      time: "2026-08-05T00:00:00.000Z",
      assetId: `cccccccc-0000-4000-8000-${String(i).padStart(12, "0")}`,
      pointKey: "TEMP_°C_µS",
      value: i,
      unit: "µS/cm",
    }));
    for (const chunk of chunkReadings(wide)) {
      assert(
        serialisedBytes(chunk) <= MAX_NOTIFY_UTF8_BYTES,
        "multi-byte units must be counted as UTF-8 bytes",
      );
    }
    assert(
      describeChunks(chunkReadings(wide)) === describeChunks(legacyChunkReadings(wide)),
      "multi-byte payloads must chunk exactly as index.js does",
    );
  }

  // ---- the cap is a parameter, so a caller can prove the split path --------

  {
    const rand = makeRandom(3);
    const readings = Array.from({ length: 10 }, (_unused, i) => makeReading(rand, i));
    const tiny = chunkReadings(readings, 200);
    assert(tiny.length > 1, "a small cap must force several chunks");
    assert(
      tiny.flat().length === readings.length,
      "chunking must never lose or duplicate a reading",
    );
  }
}
