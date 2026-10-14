import type { PointKeyStateMapDto, PointKeyStateTone } from "./index";

/**
 * `F3.74` / ADR 0088 plan D3, D12 — a breaker's state, derived once, in the web.
 *
 * The API answers a node's state points (the latest sample of every active point whose key has a
 * row in `bms.point_key_states`) and the maps for the keys it saw; it never answers a derived
 * state. `deriveBreakerState` turns the two into one of seven states, over the DTO plus the socket
 * overlay — a breaker's and, since `F3.80` (ADR 0101 d10), a valve's or damper's (`flowing`,
 * `shut`). The type-only import from `./index` is erased at emit, so there is no runtime cycle.
 */

/**
 * The ten breaker roles, in their `asset_roles.sort_order`: the five migration `0097` inserts (D10,
 * 151-155) and the five electrical position roles migration `0109` adds (`F3.80`, 161-165). A role
 * is a breaker role by membership in this list; nothing in the database says so. The flow roles
 * `0109` also adds (`isolation-valve`, `control-valve`, `damper`) are deliberately not here.
 */
export const BREAKER_ROLE_CODES = [
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
] as const;

export type BreakerRoleCode = (typeof BREAKER_ROLE_CODES)[number];

/**
 * The symbols that switch (D1b, owner ruling N1) — the core `breaker` glyph and the two library
 * breakers. This is the symbol half of ADR 0101 d4: a layout unit switches when its `is_switching`
 * flag is set or its symbol is one of these; a preset node switches through its `breaker` glyph
 * alone, in the web's `MIMIC_NODE_GLYPHS`.
 */
export const MIMIC_SWITCHING_SYMBOLS = ["breaker", "wmpid:breaker", "drawio:circuit-breaker"] as const;

const SWITCHING = new Set<string>(MIMIC_SWITCHING_SYMBOLS);

/** Whether a unit drawn with `symbol` switches. An absent symbol does not. */
export function isSwitchingSymbol(symbol: string | null | undefined): boolean {
  return symbol !== null && symbol !== undefined && SWITCHING.has(symbol);
}

/**
 * `offline`: the asset is stale. `unknown`: fresh, but no state point's latest value matches a
 * map row (no sample, an unmapped value, or no state point at all). `flowing` and `shut` are the
 * flow tones (`F3.80`, ADR 0101 d10): a valve or damper passing, or stopping, the flow.
 */
export type BreakerState = "offline" | "tripped" | "shut" | "open" | "flowing" | "closed" | "unknown";

/**
 * The part of a state point the derivation reads — structurally a `GeneratedSitePointDto`, so a
 * DTO point (with its `latest` overlaid by the socket) passes as it is.
 */
export type BreakerStatePoint = {
  readonly pointKey: string;
  readonly latest: { readonly value: number } | null;
};

export type BreakerStateInput = {
  readonly stale: boolean;
  readonly points: readonly BreakerStatePoint[];
};

/**
 * The tone order among matched points (ADR 0101 d11): a `tripped` row wins, then `shut`, then
 * `open`, then `flowing`, then `closed`.
 */
const TONE_RANK: Readonly<Record<PointKeyStateTone, number>> = { closed: 1, flowing: 2, open: 3, shut: 4, tripped: 5 };

/**
 * A breaker's state. Stale wins over every value (ADR 0088 decision 5's frame precedence starts at
 * offline); otherwise, among the points whose latest value matches a map row, the highest-ranked
 * tone wins whatever the point order; no match is `unknown`.
 *
 * The seeded map has a `breaker_trip` row for 1 only, so a breaker that reports `breaker_trip` 0
 * and no `breaker_main` is `unknown`, not `closed`: "not tripped" says nothing about the contact.
 */
export function deriveBreakerState(
  input: BreakerStateInput,
  maps: readonly PointKeyStateMapDto[],
): BreakerState {
  if (input.stale) {
    return "offline";
  }
  const byKey = new Map<string, readonly PointKeyStateMapDto["states"][number][]>();
  for (const map of maps) {
    byKey.set(map.pointKey, map.states);
  }
  let best: PointKeyStateTone | null = null;
  for (const point of input.points) {
    if (point.latest === null) {
      continue;
    }
    const value = point.latest.value;
    const row = byKey.get(point.pointKey)?.find((state) => state.value === value);
    if (row !== undefined && (best === null || TONE_RANK[row.tone] > TONE_RANK[best])) {
      best = row.tone;
    }
  }
  return best ?? "unknown";
}
