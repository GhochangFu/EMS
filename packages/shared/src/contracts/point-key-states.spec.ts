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

/** The tone vocabulary is exactly the three the `0097` CHECK restates, in its order. */
export function toneVocabularyIsExactlyThree(): void {
  const options = [...pointKeyStateToneSchema.options];
  assert(
    JSON.stringify(options) === JSON.stringify(["closed", "open", "tripped"]),
    `expected the tones ["closed","open","tripped"], got ${JSON.stringify(options)}`,
  );
}

/** A tone outside the three is refused, on the tone schema and on a state row. */
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
