import {
  adminPointKeyStateDtoSchema,
  adminPointKeyStatesListResponseSchema,
  pointKeyStateMapSchema,
  pointKeyStateSchema,
  pointKeyStateToneSchema,
  switchingStateDtoSchema,
} from "./point-key-states";

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

const ADMIN_ROW = {
  id: "00000000-0000-4000-8000-000000000001",
  pointKey: "breaker_main",
  value: 1,
  label: "CLOSED",
  tone: "closed",
  seeded: true,
};

/** `F4.309` (C1) — an admin row parses, inside the list response too; `seeded` is required. */
export function anAdminRowParses(): void {
  assert(adminPointKeyStateDtoSchema.safeParse(ADMIN_ROW).success, "an admin row — expected success");
  assert(
    adminPointKeyStatesListResponseSchema.safeParse({ items: [ADMIN_ROW] }).success,
    "a list response of one admin row — expected success",
  );
  const { seeded: _seeded, ...withoutSeeded } = ADMIN_ROW;
  assert(
    adminPointKeyStateDtoSchema.safeParse(withoutSeeded).success === false,
    "an admin row without seeded — expected a refusal",
  );
  assert(
    adminPointKeyStateDtoSchema.safeParse({ ...ADMIN_ROW, tone: "earthed" }).success === false,
    "an admin row with tone 'earthed' — expected a refusal",
  );
}

/** `F4.309` (C1) — a switching state is key, value, label and tone; no id and no `seeded` needed. */
export function aSwitchingStateParses(): void {
  const parsed = switchingStateDtoSchema.safeParse({ pointKey: "valve_open", value: 0, label: "SHUT", tone: "shut" });
  assert(parsed.success, "a switching state — expected success");
  assert(
    switchingStateDtoSchema.safeParse({ pointKey: "valve_open", value: 0, label: "SHUT" }).success === false,
    "a switching state without a tone — expected a refusal",
  );
}
