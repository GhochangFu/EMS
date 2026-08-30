import { mergeSeededAndLiveReadings } from "./dashboard-telemetry-merge";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function sample(time: string, tag: string): { time: string; tag: string } {
  return { time, tag };
}

/** No overlay yet — the seed alone, reversed to oldest-first. */
export function runNoOverlayTests(): void {
  const seededNewestFirst = [sample("2026-01-01T00:00:03Z", "c"), sample("2026-01-01T00:00:01Z", "a")];
  const merged = mergeSeededAndLiveReadings(seededNewestFirst, []);

  assert(merged.length === 2, `expected 2 samples, got ${merged.length}`);
  assert(
    merged[0]?.tag === "a" && merged[1]?.tag === "c",
    `expected oldest-first order [a, c], got [${merged.map((m) => m.tag).join(", ")}]`,
  );
}

/** The overlay extends the seed forward when it is genuinely newer. */
export function runOverlayExtendsForwardTests(): void {
  const seededNewestFirst = [sample("2026-01-01T00:00:01Z", "a")];
  const liveAscending = [sample("2026-01-01T00:00:02Z", "b")];
  const merged = mergeSeededAndLiveReadings(seededNewestFirst, liveAscending);

  assert(merged.length === 2, `expected 2 samples, got ${merged.length}`);
  assert(
    merged[0]?.tag === "a" && merged[1]?.tag === "b",
    `expected [a, b], got [${merged.map((m) => m.tag).join(", ")}]`,
  );
}

/**
 * **The load-bearing assertion (review, HIGH).** A window-focus refetch returns a fresh window
 * that already contains readings the overlay collected while backgrounded — the exact scenario
 * the finding describes. The overlapping sample must appear exactly once, not twice.
 */
export function runDuplicateOverlapIsRemovedTests(): void {
  // "b" arrived over the socket while backgrounded; the refetch's fresh window now also
  // contains it (this is the window-focus refetch replacing/re-supplying the seed).
  const seededNewestFirst = [
    sample("2026-01-01T00:00:02Z", "b"),
    sample("2026-01-01T00:00:01Z", "a"),
  ];
  const liveAscending = [sample("2026-01-01T00:00:02Z", "b")];

  const merged = mergeSeededAndLiveReadings(seededNewestFirst, liveAscending);

  assert(
    merged.length === 2,
    `"b" must appear exactly once after the refetch re-supplied it — got ${merged.length} samples: ` +
      merged.map((m) => m.tag).join(", "),
  );
  assert(
    merged[0]?.tag === "a" && merged[1]?.tag === "b",
    `expected [a, b] with no duplicate, got [${merged.map((m) => m.tag).join(", ")}]`,
  );
}

/** Ten readings arrive while backgrounded, then a refetch re-supplies all ten — the exact
 * "chart draws the polyline doubling back on itself" scenario, at a scale a single sample
 * could hide. */
export function runManyDuplicatesAreAllRemovedTests(): void {
  const overlapping = Array.from({ length: 10 }, (_, i) =>
    sample(`2026-01-01T00:01:${String(10 + i).padStart(2, "0")}Z`, `live-${i}`),
  );
  const seededNewestFirst = [...overlapping].reverse().concat([sample("2026-01-01T00:00:00Z", "oldest")]);

  const merged = mergeSeededAndLiveReadings(seededNewestFirst, overlapping);

  assert(
    merged.length === 11,
    `expected 11 distinct samples (1 seed-only + 10 overlapping), got ${merged.length}`,
  );
}
