import type { PointKeyStateMapDto, PointKeyStateTone } from "./index";

/**
 * `F3.74` / ADR 0088 plan D3, D12 — a breaker's state, derived once, in the web.
 *
 * The API answers a node's state points (the latest sample of every active point whose key has a
 * row in `bms.point_key_states`) and the maps for the keys it saw; it never answers a derived
 * state. `deriveBreakerState` turns the two into one of five states, over the DTO plus the socket
 * overlay. The type-only import from `./index` is erased at emit, so there is no runtime cycle.
 */

/**
 * The five breaker roles migration `0097` inserts (D10), in their `asset_roles.sort_order`
 * (151–155). A role is a breaker role by membership in this list; nothing in the database says so.
 */
export const BREAKER_ROLE_CODES = [
  "main-breaker",
  "ups-input-breaker",
  "ups-output-breaker",
  "load-feeder-breaker",
  "mains-feeder-breaker",
] as const;

export type BreakerRoleCode = (typeof BREAKER_ROLE_CODES)[number];

/**
 * The symbols that switch (D1b, owner ruling N1): a unit switches iff its symbol is one of these —
 * the core `breaker` glyph and the two library breakers. A layout carries no switching column; a
 * preset node switches through its `breaker` glyph in the web's `MIMIC_NODE_GLYPHS`.
 */
export const MIMIC_SWITCHING_SYMBOLS = ["breaker", "wmpid:breaker", "drawio:circuit-breaker"] as const;

const SWITCHING = new Set<string>(MIMIC_SWITCHING_SYMBOLS);

/** Whether a unit drawn with `symbol` switches. An absent symbol does not. */
export function isSwitchingSymbol(symbol: string | null | undefined): boolean {
  return symbol !== null && symbol !== undefined && SWITCHING.has(symbol);
}

/**
 * `offline`: the asset is stale. `unknown`: fresh, but no state point's latest value matches a
 * map row (no sample, an unmapped value, or no state point at all).
 */
export type BreakerState = "offline" | "tripped" | "open" | "closed" | "unknown";

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

/** The tone order among matched points: a `tripped` row wins, then `open`, then `closed`. */
const TONE_RANK: Readonly<Record<PointKeyStateTone, number>> = { closed: 1, open: 2, tripped: 3 };

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
