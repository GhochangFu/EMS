import { classifyInput, newestTimeMs } from "./calc-inputs";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export function runCalcInputsTests(): void {
  // ---- missing is never confused with stale ------------------------------------

  assert(
    classifyInput(undefined, 1_000_000, 300) === "missing",
    "an absent sample must classify as missing, never stale",
  );

  // ---- boundary: exactly at the budget counts as fresh --------------------------

  const nowMs = 1_000_000;
  const maxInputAgeSeconds = 300;
  const exactlyAtBoundary = classifyInput({ value: 1, timeMs: nowMs - maxInputAgeSeconds * 1000 }, nowMs, maxInputAgeSeconds);
  assert(exactlyAtBoundary === "fresh", "a sample exactly at the staleness budget must count as fresh");

  const oneMsPastBoundary = classifyInput(
    { value: 1, timeMs: nowMs - maxInputAgeSeconds * 1000 - 1 },
    nowMs,
    maxInputAgeSeconds,
  );
  assert(oneMsPastBoundary === "stale", "a sample 1ms past the staleness budget must count as stale");

  const wellWithinBudget = classifyInput({ value: 1, timeMs: nowMs - 1000 }, nowMs, maxInputAgeSeconds);
  assert(wellWithinBudget === "fresh", "a recent sample must count as fresh");

  // ---- newestTimeMs -------------------------------------------------------------

  assert(newestTimeMs([]) === null, "newestTimeMs of an empty list must be null");
  assert(
    newestTimeMs([{ value: 1, timeMs: 100 }, { value: 2, timeMs: 300 }, { value: 3, timeMs: 200 }]) === 300,
    "newestTimeMs must return the maximum timeMs, not the last or first entry",
  );
}
