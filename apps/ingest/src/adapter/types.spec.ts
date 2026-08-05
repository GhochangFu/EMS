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

// ---- a schema with defaults must satisfy the factory ----------------------

/**
 * ADR 0016 Amendment 1, asserted rather than trusted.
 *
 * `ZodType<T>` expands to `ZodType<T, ZodTypeDef, T>`, so a schema whose *input*
 * differs from its *output* — anything using `.default()`, `.transform()`, or a
 * fallback — does not satisfy it. The ADR's own worked MQTT example
 * (`rejectUnauthorized: z.boolean().default(true)`) is such a schema, so the
 * first real adapter written against the original signature failed to compile.
 *
 * Five fan-out agents will reach for `.default()` on day one. This fixture is
 * what stops the widening being reverted by someone tidying the signature back
 * to `ZodType<TConfig>`: revert it and this stops compiling.
 */
const configWithDefaults = z.object({
  host: z.string(),
  port: z.number(),
  rejectUnauthorized: z.boolean().default(true),
  timeoutMs: z.number().optional().default(30_000),
});

const factoryWithDefaultedSchema: IngestAdapterFactory<z.infer<typeof configWithDefaults>, unknown> =
  {
    protocol: "modbus_tcp",
    mode: "poll",
    configSchema: configWithDefaults,
    deviceSchema: z.unknown(),
    endpointKey: (config) => `${config.host}:${config.port}`,
    create: () => poll,
  };

/**
 * A `.transform()` schema too — `F1.5`'s REST poller is the likely first user,
 * mapping a JSON pointer string to a parsed accessor.
 */
const factoryWithTransformedSchema: IngestAdapterFactory<{ base: URL }, unknown> = {
  protocol: "rest_poller",
  mode: "poll",
  configSchema: z.object({ base: z.string().url() }).transform((raw) => ({ base: new URL(raw.base) })),
  deviceSchema: z.unknown(),
  endpointKey: (config) => config.base.origin,
  create: () => poll,
};

/** Referenced so `noUnusedLocals` does not delete the assertions above. */
export const typeLevelFixtures = {
  adapters,
  factory,
  pushWithoutSubscribe,
  pollWithoutPoll,
  factoryWithoutEndpointKey,
  factoryWithoutSchemas,
  factoryWithDefaultedSchema,
  factoryWithTransformedSchema,
};
