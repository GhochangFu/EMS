import { pollIntervalMsSchema } from "@bms/shared/ingest";

/**
 * The poll interval (ADR 0016 Amendment 10 (a), ADR 0141 decision 10, ruling
 * P9; `F1.2` plan T3.2). Pure: no clock, no I/O.
 *
 *   interval := config.pollIntervalMs                     -- the endpoint
 *            ?? organizations.default_poll_interval_ms   -- the organization
 *            ?? adapter.defaultPollIntervalMs            -- the adapter
 *
 * The adapter's default lives on the adapter instance, not the factory, so the
 * planner cannot read it. It resolves each RTU to a number or `null` (the
 * adapter default) and records whether any RTU on the endpoint fell through to
 * the default; the supervisor, which holds the adapter, makes the last step
 * with `pollSleepMs`.
 */

/** The level whose stored value was out of bounds. Never the value (§9.6 style). */
export type PollIntervalLevel = "endpoint" | "organization";

export type RtuPollInterval = {
  /** `null` = no endpoint or organization value: the adapter default. */
  readonly value: number | null;
  readonly warnings: readonly PollIntervalLevel[];
};

/** `undefined` and `null` are "not set"; anything else must pass the shared bound. */
function level(raw: unknown): { set: false } | { set: true; value: number | null } {
  if (raw === undefined || raw === null) {
    return { set: false };
  }
  const parsed = pollIntervalMsSchema.safeParse(raw);
  return { set: true, value: parsed.success ? parsed.data : null };
}

/**
 * One RTU's interval. A stored value outside 1,000–3,600,000 ms is replaced by
 * the next level down and reported once as a warning naming its level.
 */
export function resolveRtuPollInterval(endpointRaw: unknown, organizationRaw: unknown): RtuPollInterval {
  const warnings: PollIntervalLevel[] = [];
  const endpoint = level(endpointRaw);
  if (endpoint.set) {
    if (endpoint.value !== null) {
      return { value: endpoint.value, warnings };
    }
    warnings.push("endpoint");
  }
  const organization = level(organizationRaw);
  if (organization.set) {
    if (organization.value !== null) {
      return { value: organization.value, warnings };
    }
    warnings.push("organization");
  }
  return { value: null, warnings };
}

export type EndpointPollInterval = {
  /** The shortest value any RTU on the endpoint resolved to; `null` when none resolved one. */
  readonly pollIntervalMs: number | null;
  /** True when at least one RTU resolved to the adapter default. */
  readonly pollIntervalUsesDefault: boolean;
};

/** P9: RTUs behind one gateway share one loop, so the shortest interval wins. */
export function combineEndpointPollIntervals(values: readonly (number | null)[]): EndpointPollInterval {
  const set = values.filter((value): value is number => value !== null);
  return {
    pollIntervalMs: set.length === 0 ? null : Math.min(...set),
    pollIntervalUsesDefault: set.length < values.length || values.length === 0,
  };
}

/** What the supervisor sleeps between two reads. */
export function pollSleepMs(plan: EndpointPollInterval, adapterDefaultMs: number): number {
  if (plan.pollIntervalMs === null) {
    return adapterDefaultMs;
  }
  return plan.pollIntervalUsesDefault ? Math.min(plan.pollIntervalMs, adapterDefaultMs) : plan.pollIntervalMs;
}
