/**
 * `F4.379` — a stored telemetry value as text, without its binary tail.
 *
 * Two tails, one rule each, and no real digit rounded away (49.96 Hz is not 50 Hz, PR #1364):
 *
 *  - **A float32 register** (`getFloat32` at ingest, widened to a double): the value is exactly a
 *    float32, so it prints as the shortest decimal that reads back to the same float32 —
 *    `12.300000190734863` → `12.3`. A sensor's float32 holds no more than that.
 *  - **Any other double** (an int16 × 0.1 from a decoder, a computed value): twelve significant
 *    digits drop the tail — `0.3000000000000007` → `0.3`, `-6.3999999999999995` → `-6.4` (a WBLDC
 *    cold room, the AWS demo's checks) — and keep every digit a sensor sends.
 */
export function withoutFloatNoise(value: number): string {
  if (Math.fround(value) === value) {
    for (let digits = 1; digits <= 9; digits += 1) {
      const shortest = Number(value.toPrecision(digits));
      if (Math.fround(shortest) === value) {
        return String(shortest);
      }
    }
  }
  return String(Number(value.toPrecision(12)));
}
