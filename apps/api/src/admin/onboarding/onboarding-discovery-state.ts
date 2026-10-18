import { z } from "zod";

import {
  discoveryDtoOf,
  MQTT_DISCOVERY_HOST_MAX,
  MQTT_DISCOVERY_MAX_WINDOW_SECONDS,
  MQTT_DISCOVERY_MIN_WINDOW_SECONDS,
  MQTT_DISCOVERY_RTU_CODE_MAX,
  MQTT_DISCOVERY_TOPIC_MAX,
  onboardingDiscoveryStoredSchema,
} from "@bms/shared";
import type { OnboardingDiscoveryResultDto, OnboardingDiscoveryStored } from "@bms/shared";

/** The draft key the discovery worker writes (ADR 0103). Server state; never sent to the client. */
export const DISCOVERY_KEY = "_discovery";

/**
 * The draft key a `propose_discovery` turn writes (`F3.24b` U4), beside
 * `_commitProposal`: server state, cleared by every draft write and by a
 * restore (accuracy review #8), never sent to the client or the model.
 */
export const DISCOVERY_PROPOSAL_KEY = "_discoveryProposal";

/**
 * `F3.24b` U4 — the stored `_discoveryProposal`: the `propose_discovery`
 * arguments the turn validated, the broker the card shows (H3) and when.
 * Strict and bounded, so a malformed blob reads as none.
 */
export const discoveryProposalSchema = z
  .object({
    rtuCode: z.string().min(2).max(MQTT_DISCOVERY_RTU_CODE_MAX),
    topicPrefix: z.string().min(1).max(MQTT_DISCOVERY_TOPIC_MAX),
    windowSeconds: z.number().int().min(MQTT_DISCOVERY_MIN_WINDOW_SECONDS).max(MQTT_DISCOVERY_MAX_WINDOW_SECONDS),
    host: z.string().min(1).max(MQTT_DISCOVERY_HOST_MAX),
    port: z.number().int().min(1).max(65_535),
    proposedAt: z.string(),
  })
  .strict();

export type StoredDiscoveryProposal = z.infer<typeof discoveryProposalSchema>;

/** A shallow copy of `draft` carrying `proposal` as `_discoveryProposal`. */
export function attachDiscoveryProposal<T extends object>(draft: T, proposal: StoredDiscoveryProposal): T {
  return { ...draft, [DISCOVERY_PROPOSAL_KEY]: proposal };
}

/** The stored discovery proposal, or `null`. Fails closed. */
export function readDiscoveryProposal(draft: unknown): StoredDiscoveryProposal | null {
  if (typeof draft !== "object" || draft === null) {
    return null;
  }
  const parsed = discoveryProposalSchema.safeParse((draft as Record<string, unknown>)[DISCOVERY_PROPOSAL_KEY]);
  return parsed.success ? parsed.data : null;
}

/**
 * How long a `running` discovery stays busy past its window: the worker's
 * connect timeout and the second transaction fit well inside it. A worker that
 * died mid-window must not block the session for ever (decisions #7).
 */
export const DISCOVERY_RUNNING_GRACE_MS = 60_000;

/** `draft._discovery` in the stored shape (with `queuedAt` and the counters), or `null`. Fails closed. */
export function readStoredDiscovery(draft: unknown): OnboardingDiscoveryStored | null {
  if (typeof draft !== "object" || draft === null) {
    return null;
  }
  const parsed = onboardingDiscoveryStoredSchema.safeParse((draft as Record<string, unknown>)[DISCOVERY_KEY]);
  return parsed.success ? parsed.data : null;
}

/**
 * `draft._discovery` as the DTO the session carries, or `null`.
 *
 * Fails closed: a blob that does not parse as the stored shape reads as no
 * discovery, never as a half-trusted one. The stored shape (with `queuedAt`
 * and the counters) is parsed, then mapped, so the strict DTO never sees a
 * stored-only key (accuracy review #4).
 */
export function readDiscovery(draft: unknown): OnboardingDiscoveryResultDto | null {
  const stored = readStoredDiscovery(draft);
  return stored === null ? null : discoveryDtoOf(stored);
}

/**
 * Whether `stored` still holds the session (and, through the route's
 * per-organization check, the organization — security review M3).
 *
 * - `queued` is busy with **no** stale bound: the worker runs one job at a
 *   time per queue across every tenant, so a job can wait behind others for
 *   minutes and still run (decisions #7).
 * - `running` is busy until `startedAt + windowSeconds + 60 s`; a `running`
 *   row with no `startedAt` cannot be bounded, so it stays busy.
 * - `done` and `failed` are not busy.
 */
export function discoveryIsBusy(stored: OnboardingDiscoveryStored | null, nowMs: number): boolean {
  if (stored === null) {
    return false;
  }
  if (stored.status === "queued") {
    return true;
  }
  if (stored.status !== "running") {
    return false;
  }
  const started = stored.startedAt === null ? Number.NaN : Date.parse(stored.startedAt);
  if (!Number.isFinite(started)) {
    return true;
  }
  return nowMs <= started + stored.windowSeconds * 1000 + DISCOVERY_RUNNING_GRACE_MS;
}

/**
 * A shallow copy of `merged` whose `_discovery` is the **locked row's**.
 *
 * `draftHash` leaves `_discovery` out (the worker writes it while a turn
 * runs), so a turn built on a draft read before the lock passes its hash
 * re-check even when the worker wrote in between. Without this, storing that
 * turn's draft would put the older `_discovery` back over the worker's result.
 */
export function withDiscoveryOf<T>(locked: unknown, merged: T): T {
  if (typeof merged !== "object" || merged === null || Array.isArray(merged)) {
    return merged;
  }
  const copy = { ...(merged as Record<string, unknown>) };
  const current =
    typeof locked === "object" && locked !== null ? (locked as Record<string, unknown>)[DISCOVERY_KEY] : undefined;
  if (current === undefined) {
    delete copy[DISCOVERY_KEY];
  } else {
    copy[DISCOVERY_KEY] = current;
  }
  return copy as T;
}
