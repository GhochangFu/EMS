import { pointKeyStateMapSchema, pointKeyStateSchema, pointKeyStateToneSchema } from "./point-key-states";

/**
 * `F3.74` / ADR 0088 plan D3 — the state-map contract (`bms.point_key_states`, migration `0097`).
 *
 * Assertions live here; `point-key-states.test.ts` is the vitest entry point (ADR 0014). One
 * claim per exported function.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The tone vocabulary is exactly the five the `0109` CHECK restates (`F3.80`, ADR 0101 d10), in its order. */
export function toneVocabularyIsExactlyFive(): void {
  const options = [...pointKeyStateToneSchema.options];
  const expected = ["closed", "open", "tripped", "flowing", "shut"];
  assert(
    JSON.stringify(options) === JSON.stringify(expected),
    `expected the tones ${JSON.stringify(expected)}, got ${JSON.stringify(options)}`,
  );
}

/** `F3.80` — a tone beyond the five (`earthed`; ADR 0101 rules no sixth tone) is refused. */
export function earthedIsRefused(): void {
  assert(pointKeyStateToneSchema.safeParse("earthed").success === false, "tone 'earthed' — expected a refusal");
  assert(
    pointKeyStateSchema.safeParse({ value: 2, label: "EARTHED", tone: "earthed" }).success === false,
    "a state row with tone 'earthed' — expected a refusal",
  );
}

/** `F3.80` — a state row with the flow tone `shut` (a valve's or a damper's 0) parses. */
export function shutIsAccepted(): void {
  assert(
    pointKeyStateSchema.safeParse({ value: 0, label: "SHUT", tone: "shut" }).success === true,
    "a state row with tone 'shut' — expected success",
  );
}

/** A tone outside the vocabulary is refused, on the tone schema and on a state row. */
export function anUnknownToneIsRefused(): void {
  assert(pointKeyStateToneSchema.safeParse("ok").success === false, "tone 'ok' — expected a refusal");
  assert(
    pointKeyStateSchema.safeParse({ value: 1, label: "OK", tone: "ok" }).success === false,
    "a state row with tone 'ok' — expected a refusal",
  );
  // Anti-vacuity: the same row with a ruled tone parses.
  assert(
    pointKeyStateSchema.safeParse({ value: 1, label: "CLOSED", tone: "closed" }).success === true,
    "a state row with tone 'closed' — expected success",
  );
}

/** A map is one point key and its rows. */
export function aStateMapParses(): void {
  const parsed = pointKeyStateMapSchema.safeParse({
    pointKey: "breaker_main",
    states: [
      { value: 0, label: "OPEN", tone: "open" },
      { value: 1, label: "CLOSED", tone: "closed" },
    ],
  });
  assert(parsed.success === true, "a breaker_main map — expected success");
}
