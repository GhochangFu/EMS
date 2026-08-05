import { z } from "zod";

import type {
  IngestAdapter,
  IngestAdapterFactory,
  PollIngestAdapter,
  PushIngestAdapter,
} from "./types.js";

/**
 * `F1.1` / ADR 0016 §1 — the adapter contract, asserted at the type level.
 *
 * There is nothing to execute here: the interface is types, and types are
 * erased. What these assertions catch is the interface *loosening* — which is
 * exactly what happened once already on this branch, where a flat
 * `{ mode, subscribe?, poll? }` shipped in place of the ADR's discriminated
 * union and would have let five fan-out agents each half-implement it.
 *
 * `@ts-expect-error` is the mechanism: each one **fails the build if the error
 * stops occurring**, so a loosened contract cannot pass CI silently.
 */

const noopHealth = () => ({ state: "disconnected" }) as const;

// ---- the union admits a complete push adapter -----------------------------

const push: PushIngestAdapter<unknown, unknown> = {
  mode: "push",
  connect: async () => undefined,
  disconnect: async () => undefined,
  health: noopHealth,
  subscribe: async () => undefined,
};

// ---- and a complete poll adapter ------------------------------------------

const poll: PollIngestAdapter<unknown, unknown> = {
  mode: "poll",
  connect: async () => undefined,
  disconnect: async () => undefined,
  health: noopHealth,
  defaultPollIntervalMs: 5_000,
  poll: async () => [],
};

const adapters: IngestAdapter[] = [push, poll];

// ---- but not a push adapter missing its half ------------------------------

// @ts-expect-error `mode: "push"` without `subscribe` must not compile — this
// is ADR 0016 Options B3's stated reason for a discriminated union.
const pushWithoutSubscribe: PushIngestAdapter<unknown, unknown> = {
  mode: "push",
  connect: async () => undefined,
  disconnect: async () => undefined,
  health: noopHealth,
};

// @ts-expect-error `mode: "poll"` without `poll`/`defaultPollIntervalMs` likewise.
const pollWithoutPoll: PollIngestAdapter<unknown, unknown> = {
  mode: "poll",
  connect: async () => undefined,
  disconnect: async () => undefined,
  health: noopHealth,
};

// ---- and not a factory missing what the fan-out must implement ------------

const factory: IngestAdapterFactory = {
  protocol: "mqtt",
  mode: "push",
  configSchema: z.unknown(),
  deviceSchema: z.unknown(),
  endpointKey: (_config, rtuId) => rtuId,
  create: () => push,
};

// @ts-expect-error `endpointKey` is ADR 0016 §7's "one mistake that costs a
// broker N connections" — omitting it must not compile.
const factoryWithoutEndpointKey: IngestAdapterFactory = {
  protocol: "mqtt",
  mode: "push",
  configSchema: z.unknown(),
  deviceSchema: z.unknown(),
  create: () => push,
};

// @ts-expect-error the Zod schemas are what force `rtu_connection_configs.config`
// — untrusted JSONB — through validation before `connect` (AGENTS.md §4.3).
const factoryWithoutSchemas: IngestAdapterFactory = {
  protocol: "mqtt",
  mode: "push",
  // Annotated explicitly: with `configSchema` absent there is no `TConfig` to
  // infer from, and the resulting implicit-any is a *different* error from the
  // one being asserted.
  endpointKey: (_config: unknown, rtuId: string) => rtuId,
  create: () => push,
};

/** Referenced so `noUnusedLocals` does not delete the assertions above. */
export const typeLevelFixtures = {
  adapters,
  factory,
  pushWithoutSubscribe,
  pollWithoutPoll,
  factoryWithoutEndpointKey,
  factoryWithoutSchemas,
};
