import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import type { AuditInput } from "../admin/master-data-audit.service";
import { ChannelWritesService } from "./channel-writes.service";

/**
 * `F4.279` (ADR 0099 Amendment 8, "Common to every entry") — every channel write
 * audits through `MasterDataAuditService`, so a confirmed copilot change carries
 * `via: "copilot"`. Assertions only (§4.6); `channel-writes.service.test.ts`
 * owns the runner. The funnel is a recording fake: each claim reads what the
 * service handed it, never a lifetime counter.
 */

type Ctor = ConstructorParameters<typeof ChannelWritesService>;

const ORG = "aaaaaaaa-0000-4000-8000-00000000000a";
const CHANNEL_ID = "33333333-3333-4333-8333-333333333333";
const RULE_ID = "44444444-4444-4444-8444-444444444444";
const FLEET_CHANNEL = "55555555-5555-4555-8555-555555555555";
const SECRET = "s3cret-value-never-audited";

const ACTOR = {
  sub: "u2",
  email: "org@bms.local",
  name: "Org",
  role: "organization_admin",
} as JwtPayload;

function storedRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CHANNEL_ID,
    organizationId: ORG,
    code: "ops",
    name: "Ops",
    kind: "webhook",
    config: { url: "https://hooks.example.test/x" },
    enabled: true,
    secretCiphertext: Buffer.from("x"),
    secretIv: Buffer.from("y"),
    secretKeyVersion: 1,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

/**
 * The tenant pool: `withTenant` opens a transaction, sets the GUC with
 * `execute`, and the write runs on the transaction.
 */
function tenantDb(row: Record<string, unknown>): Ctor[1] {
  const tx = {
    execute: () => Promise.resolve(undefined),
    insert: () => ({
      values: () => Object.assign(Promise.resolve(undefined), { returning: () => Promise.resolve([row]) }),
    }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([row]) }) }) }),
    delete: () => ({ where: () => Promise.resolve(undefined) }),
  };
  return { transaction: (fn: (t: unknown) => Promise<unknown>) => fn(tx) } as unknown as Ctor[1];
}

/**
 * The fleet pool. Reads answer in call order from `answers`: `where()` returns a
 * thenable that also has `limit`, so a read with or without `.limit(1)` takes the
 * next answer. An unexpected extra read throws rather than answering `[]`.
 */
function fleetDb(answers: unknown[][]): Ctor[0] {
  const queue = [...answers];
  const next = (): Promise<unknown[]> => {
    const answer = queue.shift();
    if (answer === undefined) return Promise.reject(new Error("fleetDb: an unexpected read"));
    return Promise.resolve(answer);
  };
  const whereable = () => ({
    where: () => {
      const result = next();
      return Object.assign(result, { limit: () => result });
    },
  });
  return {
    select: () => ({
      from: () => ({ ...whereable(), innerJoin: () => whereable() }),
    }),
  } as unknown as Ctor[0];
}

const crypto = {
  encrypt: () => ({ ciphertext: Buffer.from("x"), iv: Buffer.from("y"), keyVersion: 1 }),
} as unknown as Ctor[2];

const accessControl = {
  requireMasterDataUser: () => Promise.resolve({ role: "organization_admin" }),
  canManageNotificationChannel: () => Promise.resolve(true),
  writableOrganizationIds: () => Promise.resolve([ORG]),
} as unknown as Ctor[3];

function recordingFunnel(): { funnel: Ctor[4]; calls: { input: AuditInput; executor: unknown }[] } {
  const calls: { input: AuditInput; executor: unknown }[] = [];
  const funnel = {
    write: (input: AuditInput, executor: unknown) => {
      calls.push({ input, executor });
      return Promise.resolve();
    },
  } as unknown as Ctor[4];
  return { funnel, calls };
}

async function created(): Promise<{ calls: { input: AuditInput; executor: unknown }[]; fleet: Ctor[0] }> {
  const { funnel, calls } = recordingFunnel();
  const fleet = fleetDb([]);
  const service = new ChannelWritesService(fleet, tenantDb(storedRow()), crypto, accessControl, funnel);
  await service.create(ACTOR, {
    organizationId: ORG,
    code: "ops",
    name: "Ops",
    kind: "webhook",
    config: { url: "https://hooks.example.test/x" },
    secret: SECRET,
    enabled: true,
  });
  return { calls, fleet };
}

/** A create hands the funnel exactly one row. */
export async function theCreateWritesOneAuditRow(): Promise<void> {
  const { calls } = await created();
  expect(calls.map((call) => call.input.action)).toEqual(["notification_channel_create"]);
}

/** The create's row is stamped with the channel's organization. */
export async function theCreateAuditCarriesTheChannelsOrganization(): Promise<void> {
  const { calls } = await created();
  expect(calls[0]?.input.organizationId).toBe(ORG);
}

/** The create's row is written on the fleet pool (`null` is admitted `TO bms_fleet` alone). */
export async function theCreateAuditIsWrittenOnTheFleetPool(): Promise<void> {
  const { calls, fleet } = await created();
  expect(calls[0]?.executor).toBe(fleet);
}

/** The create's payload says a secret is stored. */
export async function theCreateAuditSaysASecretIsStored(): Promise<void> {
  const { calls } = await created();
  expect(calls[0]?.input.payload?.hasSecret).toBe(true);
}

/** The create's payload never carries the secret (§9.6). */
export async function theCreateAuditNeverCarriesTheSecret(): Promise<void> {
  const { calls } = await created();
  expect(JSON.stringify(calls[0]?.input)).not.toContain(SECRET);
}

async function updated(body: Record<string, unknown>): Promise<AuditInput | undefined> {
  const { funnel, calls } = recordingFunnel();
  const service = new ChannelWritesService(
    fleetDb([[{ organizationId: ORG }]]),
    tenantDb(storedRow()),
    crypto,
    accessControl,
    funnel,
  );
  await service.update(ACTOR, CHANNEL_ID, body);
  return calls[0]?.input;
}

/** An update's payload lists the fields it changed, not their values. */
export async function theUpdateAuditListsTheChangedFields(): Promise<void> {
  const input = await updated({ name: "Ops desk", secret: SECRET });
  expect(input?.payload?.changed).toEqual(["name", "secret"]);
}

/** A replaced secret is recorded as rotated. */
export async function theUpdateAuditRecordsARotation(): Promise<void> {
  const input = await updated({ secret: SECRET });
  expect(input?.payload?.secretRotated).toBe(true);
}

/** A `null` secret is recorded as cleared. */
export async function theUpdateAuditRecordsAClear(): Promise<void> {
  const input = await updated({ secret: null });
  expect(input?.payload?.secretCleared).toBe(true);
}

/** `setRuleChannels` audits the set, and the join it kept for the caller. */
export async function theRuleChannelSetAuditsThePreservedJoins(): Promise<void> {
  const { funnel, calls } = recordingFunnel();
  const service = new ChannelWritesService(
    fleetDb([
      // the rule
      [{ id: RULE_ID, organizationId: ORG }],
      // the submitted channels' organizations
      [{ id: CHANNEL_ID, organizationId: ORG }],
      // the existing joins: one to a fleet-wide channel the caller cannot see
      [{ channelId: FLEET_CHANNEL, channelOrganizationId: null }],
    ]),
    tenantDb(storedRow()),
    crypto,
    accessControl,
    funnel,
  );
  await service.setRuleChannels(RULE_ID, [CHANNEL_ID], ACTOR);
  expect({ action: calls[0]?.input.action, preserved: calls[0]?.input.payload?.preservedChannelIds }).toEqual({
    action: "rule_notifications_set",
    preserved: [FLEET_CHANNEL],
  });
}
