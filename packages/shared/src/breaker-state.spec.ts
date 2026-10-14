import {
  BREAKER_ROLE_CODES,
  MIMIC_SWITCHING_SYMBOLS,
  deriveBreakerState,
  isSwitchingSymbol,
  type BreakerStatePoint,
} from "./breaker-state";
import { mimicCoreSymbolSchema } from "./contracts/mimic-layouts";
import type { PointKeyStateMapDto } from "./index";
import { symbolLibraryLabel } from "./mimic-symbol-libraries";

/**
 * `F3.74` / ADR 0088 plan D3 — `deriveBreakerState` and the switching-symbol rule.
 *
 * Assertions live here; `breaker-state.test.ts` is the vitest entry point (ADR 0014). One claim
 * per exported function, so a mutation reddens the `it` that owns it.
 *
 * **Point order is deliberate.** Every fixture that must prove a priority lists the LOWER-priority
 * point first, so a first-match walk (or a dropped priority) answers the lower tone and reddens.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * The seed's breaker and valve rows (`point-key-states-seed.ts`; `valve_open` is `F3.80`'s flow
 * pair), plus a third key with a tripped row.
 */
const MAPS: readonly PointKeyStateMapDto[] = [
  {
    pointKey: "breaker_main",
    states: [
      { value: 0, label: "OPEN", tone: "open" },
      { value: 1, label: "CLOSED", tone: "closed" },
    ],
  },
  { pointKey: "breaker_trip", states: [{ value: 1, label: "TRIPPED", tone: "tripped" }] },
  { pointKey: "relay_state", states: [{ value: 2, label: "LOCKOUT", tone: "tripped" }] },
  {
    pointKey: "valve_open",
    states: [
      { value: 0, label: "SHUT", tone: "shut" },
      { value: 1, label: "OPEN", tone: "flowing" },
    ],
  },
];

function point(pointKey: string, value: number | null): BreakerStatePoint {
  return { pointKey, latest: value === null ? null : { value } };
}

/** A stale asset is `offline` even when its latest value maps to `closed`. */
export function staleBeatsAClosedValue(): void {
  const state = deriveBreakerState({ stale: true, points: [point("breaker_main", 1)] }, MAPS);
  assert(state === "offline", `stale + breaker_main 1 — expected offline, got ${state}`);
}

/** `breaker_trip` 1 beats `breaker_main` 1 (the closed point is listed first). */
export function tripBeatsClosed(): void {
  const state = deriveBreakerState(
    { stale: false, points: [point("breaker_main", 1), point("breaker_trip", 1)] },
    MAPS,
  );
  assert(state === "tripped", `breaker_main 1 + breaker_trip 1 — expected tripped, got ${state}`);
}

/** An open tone beats a closed one (the closed point is listed first). */
export function openBeatsClosed(): void {
  const state = deriveBreakerState(
    { stale: false, points: [point("breaker_main", 1), point("breaker_main", 0)] },
    MAPS,
  );
  assert(state === "open", `breaker_main 1 + breaker_main 0 — expected open, got ${state}`);
}

/** `breaker_main` 0 alone is `open`. */
export function mainZeroIsOpen(): void {
  const state = deriveBreakerState({ stale: false, points: [point("breaker_main", 0)] }, MAPS);
  assert(state === "open", `breaker_main 0 — expected open, got ${state}`);
}

/** `breaker_main` 1 alone is `closed` (the positive case beside the unknown ones). */
export function mainOneIsClosed(): void {
  const state = deriveBreakerState({ stale: false, points: [point("breaker_main", 1)] }, MAPS);
  assert(state === "closed", `breaker_main 1 — expected closed, got ${state}`);
}

/** A value with no map row is `unknown`. */
export function anUnmappedValueIsUnknown(): void {
  const state = deriveBreakerState({ stale: false, points: [point("breaker_main", 7)] }, MAPS);
  assert(state === "unknown", `breaker_main 7 — expected unknown, got ${state}`);
}

/** A point with no latest sample is `unknown`. */
export function aNullLatestIsUnknown(): void {
  const state = deriveBreakerState({ stale: false, points: [point("breaker_main", null)] }, MAPS);
  assert(state === "unknown", `breaker_main null — expected unknown, got ${state}`);
}

/** A third key whose row carries the tripped tone wins too (listed after a closed point). */
export function aThirdKeysTrippedRowWins(): void {
  const state = deriveBreakerState(
    { stale: false, points: [point("breaker_main", 1), point("relay_state", 2)] },
    MAPS,
  );
  assert(state === "tripped", `breaker_main 1 + relay_state 2 — expected tripped, got ${state}`);
}

/** `F3.80` — `valve_open` 1 alone is `flowing` (the flow twin of CLOSED). */
export function valveOneDerivesFlowing(): void {
  const state = deriveBreakerState({ stale: false, points: [point("valve_open", 1)] }, MAPS);
  assert(state === "flowing", `valve_open 1 — expected flowing, got ${state}`);
}

/** `F3.80` — `valve_open` 0 alone is `shut` (the flow twin of OPEN). */
export function valveZeroDerivesShut(): void {
  const state = deriveBreakerState({ stale: false, points: [point("valve_open", 0)] }, MAPS);
  assert(state === "shut", `valve_open 0 — expected shut, got ${state}`);
}

/** `F3.80` d11 — `shut` outranks `flowing` (the flowing point is listed first). */
export function shutOutranksFlowing(): void {
  const state = deriveBreakerState(
    { stale: false, points: [point("valve_open", 1), point("valve_open", 0)] },
    MAPS,
  );
  assert(state === "shut", `valve_open 1 + valve_open 0 — expected shut, got ${state}`);
}

/** `F3.80` d11 — `tripped` outranks `shut` (the shut point is listed first). */
export function trippedOutranksShut(): void {
  const state = deriveBreakerState(
    { stale: false, points: [point("valve_open", 0), point("breaker_trip", 1)] },
    MAPS,
  );
  assert(state === "tripped", `valve_open 0 + breaker_trip 1 — expected tripped, got ${state}`);
}

/** `F3.80` d11 — `open` outranks `flowing` (the flowing point is listed first). */
export function openOutranksFlowing(): void {
  const state = deriveBreakerState(
    { stale: false, points: [point("valve_open", 1), point("breaker_main", 0)] },
    MAPS,
  );
  assert(state === "open", `valve_open 1 + breaker_main 0 — expected open, got ${state}`);
}

/** `F3.80` — a stale asset is `offline` even when its latest value maps to `flowing`. */
export function staleBeatsFlowing(): void {
  const state = deriveBreakerState({ stale: true, points: [point("valve_open", 1)] }, MAPS);
  assert(state === "offline", `stale + valve_open 1 — expected offline, got ${state}`);
}

/** The core `breaker` glyph switches. */
export function breakerSymbolSwitches(): void {
  assert(isSwitchingSymbol("breaker") === true, `isSwitchingSymbol("breaker") — expected true`);
}

/** A `switchboard` (and an absent symbol) does not switch. */
export function switchboardDoesNotSwitch(): void {
  assert(isSwitchingSymbol("switchboard") === false, `isSwitchingSymbol("switchboard") — expected false`);
  assert(isSwitchingSymbol(null) === false, "isSwitchingSymbol(null) — expected false");
}

/** The two library breakers switch (N1), and every listed key is a real symbol. */
export function libraryBreakersSwitchAndExist(): void {
  for (const key of ["wmpid:breaker", "drawio:circuit-breaker"]) {
    assert(isSwitchingSymbol(key) === true, `isSwitchingSymbol("${key}") — expected true`);
  }
  for (const key of MIMIC_SWITCHING_SYMBOLS) {
    const known = mimicCoreSymbolSchema.safeParse(key).success || symbolLibraryLabel(key) !== null;
    assert(known, `MIMIC_SWITCHING_SYMBOLS lists "${key}", which no symbol vocabulary declares`);
  }
}

/** The ten breaker roles: `0097`'s five (sort order 151-155), then `0109`'s five electrical position roles (161-165). */
export function breakerRoleCodesAreTheTen(): void {
  const expected = [
    "main-breaker",
    "ups-input-breaker",
    "ups-output-breaker",
    "load-feeder-breaker",
    "mains-feeder-breaker",
    "ht-incomer-breaker",
    "ht-outgoing-breaker",
    "bus-coupler",
    "isolator",
    "dg-breaker",
  ];
  assert(
    JSON.stringify([...BREAKER_ROLE_CODES]) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(BREAKER_ROLE_CODES)}`,
  );
}

/** D8's negative half: a flow role is never a breaker role. */
export function noFlowRoleIsABreakerRole(): void {
  const roles: readonly string[] = BREAKER_ROLE_CODES;
  for (const flow of ["isolation-valve", "control-valve", "damper"]) {
    assert(!roles.includes(flow), `"${flow}" must not be a breaker role`);
  }
}
