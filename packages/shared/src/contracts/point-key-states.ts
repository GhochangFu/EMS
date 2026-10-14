import { z } from "zod";

/**
 * `F3.74` / ADR 0088 plan D1, D3 — the fleet-wide state map (`bms.point_key_states`, migration
 * `0097`): which value of a point key means which switch state.
 *
 * Global master data like `bms.point_keys`, and seed-owned (`point-key-states-seed.ts`). The API
 * answers the rows for the keys it saw; the web derives a breaker's state from them with
 * `deriveBreakerState` (`../breaker-state.ts`, D12) — the API never answers a derived state.
 *
 * Plain `z.object` throughout (ADR 0030 decision 2).
 */

/**
 * The tones a state row may carry: a breaker's `closed | open | tripped` (`F3.74`) and a valve's or
 * damper's `flowing | shut` (`F3.80`, ADR 0101 d10). Restated by `point_key_states_tone_check`,
 * which `0109` widened from `0097`'s three; `tests/f3.80-network-mimics-migration.test.ts` holds
 * the two equal, so keep this on one line.
 */
export const pointKeyStateToneSchema = z.enum(["closed", "open", "tripped", "flowing", "shut"]);

/** One row: a value of the point key, its label (`CLOSED`, `TRIPPED`) and its tone. */
export const pointKeyStateSchema = z.object({
  value: z.number(),
  label: z.string(),
  tone: pointKeyStateToneSchema,
});

/** Every row of one point key. */
export const pointKeyStateMapSchema = z.object({
  pointKey: z.string(),
  states: z.array(pointKeyStateSchema),
});
