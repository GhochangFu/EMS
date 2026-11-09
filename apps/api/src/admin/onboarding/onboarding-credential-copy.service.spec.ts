import { BadRequestException, ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { draftHash } from "./onboarding-commit-proposal";
import {
  COPY_KEY_VERSION,
  COPY_NEEDS_KEY,
  COPY_PROPOSED_DRAFT_CHANGED,
  copySourceHasNoCredential,
  copyTargetNotSameBroker,
  OnboardingCredentialCopyService,
} from "./onboarding-credential-copy.service";

/**
 * `F4.339` (ADR 0117 decision 7, plan R7) — the copy's refusals that happen
 * before the write transaction, with a draft source. The write itself is the
 * integration suite's (`onboarding-credential-copy.integration`, CC1–CC5).
 * Assertions here; the sibling `.test.ts` is the Vitest entry point (ADR 0014).
 */

const JWT = { sub: "u1", role: "organization_admin" } as unknown as JwtPayload;
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
export const TEST_KEY = Buffer.alloc(32, 0x03).toString("base64");

function service(
  secrets: Record<string, unknown>,
  thirdConfig: Record<string, unknown> = { host: "broker.test", port: 8883 },
  tenantDb: unknown = {},
) {
  const draft = {
    rtus: [
      { code: "A", displayName: "A", protocol: "mqtt", config: { host: "broker.test", port: 8883 } },
      { code: "B", displayName: "B", protocol: "mqtt", config: { host: "broker.test", port: 8883 } },
      { code: "C", displayName: "C", protocol: "mqtt", config: thirdConfig },
    ],
    _secrets: secrets,
  };
  lastDraft = draft;
  const sessions = {
    loadSession: async () => ({ id: SESSION_ID, organizationId: "o1", status: "draft", draft, lockReason: null }),
  };
  // No database by default: those cases refuse before the write transaction.
  return new OnboardingCredentialCopyService(tenantDb as never, {} as never, {} as never, sessions as never);
}

/** The draft the last {@link service} loads, so a case can hash it. */
let lastDraft: unknown;

const fail = (promise: Promise<unknown>) => promise.then(() => new Error("expected a refusal"), (err: unknown) => err);

/** No key loaded: 503, the `setCredentials` rule. */
export async function noKeyIsA503(): Promise<void> {
  const err = await fail(service({ A: { c: "eA==", iv: "eA==" } }).copy(JWT, SESSION_ID, { from: { rtuIndex: 0 }, toRtuIndexes: [1] }));
  expect(err).toEqual(new ServiceUnavailableException(COPY_NEEDS_KEY));
}

/** A source with no stored credential: 409 naming its code. */
export async function aSourceWithNoCredentialIsA409(): Promise<void> {
  const err = await fail(service({}).copy(JWT, SESSION_ID, { from: { rtuIndex: 0 }, toRtuIndexes: [1] }));
  expect(err).toEqual(new ConflictException(copySourceHasNoCredential("A")));
}

/** A blob at a key version this API cannot read now: 409 (R7). */
export async function anUnreadableKeyVersionIsA409(): Promise<void> {
  const err = await fail(service({ A: { c: "eA==", iv: "eA==", v: 99 } }).copy(JWT, SESSION_ID, { from: { rtuIndex: 0 }, toRtuIndexes: [1] }));
  expect(err).toEqual(new ConflictException(COPY_KEY_VERSION));
}

/** A target on another broker (TLS off here): 409 naming the target. */
export async function aTargetOnAnotherBrokerIsA409(): Promise<void> {
  const svc = service({ A: { c: "eA==", iv: "eA==" } }, { host: "broker.test", port: 8883, tls: false });
  const err = await fail(svc.copy(JWT, SESSION_ID, { from: { rtuIndex: 0 }, toRtuIndexes: [1, 2] }));
  expect(err).toEqual(new ConflictException(copyTargetNotSameBroker("C")));
}

/** A draft source whose bound blob its RTU no longer serves is no credential to copy (review H1 follow-up). */
export async function aStaleBoundSourceIsA409(): Promise<void> {
  const stale = { c: "eA==", iv: "eA==", b: { host: "elsewhere.test", port: 8883, tls: true } };
  const err = await fail(service({ A: stale }).copy(JWT, SESSION_ID, { from: { rtuIndex: 0 }, toRtuIndexes: [1] }));
  expect(err).toEqual(new ConflictException(copySourceHasNoCredential("A")));
}

/** `F4.339` PR 9 (Amendment 18 Q3): a card's `draftHash` that is not the stored draft's: 400, nothing is written. */
export async function aStaleDraftHashIsA400(): Promise<void> {
  const svc = service({ A: { c: "eA==", iv: "eA==" } });
  const err = await fail(svc.copy(JWT, SESSION_ID, { from: { rtuIndex: 0 }, toRtuIndexes: [1], draftHash: "b".repeat(64) }));
  expect(err).toEqual(new BadRequestException(COPY_PROPOSED_DRAFT_CHANGED));
  expect(COPY_PROPOSED_DRAFT_CHANGED).toBe("The draft changed since this copy was proposed, so nothing was copied. Ask for the copy again.");
}

/** The adjacent positive: the stored draft's own hash passes the bind and the next check answers. */
export async function theStoredDraftsHashPassesTheBind(): Promise<void> {
  const svc = service({});
  const hash = draftHash(lastDraft);
  if (hash === null) throw new Error("the fixture draft hashes");
  const err = await fail(svc.copy(JWT, SESSION_ID, { from: { rtuIndex: 0 }, toRtuIndexes: [1], draftHash: hash }));
  expect(err).toEqual(new ConflictException(copySourceHasNoCredential("A")));
}

/**
 * Review finding 4: a draft that moved between the load and the row lock answers the card's own
 * 400, not the turn's 409. The transaction is faked: the locked row is the moved draft.
 */
export async function aDraftMovedBeforeTheLockIsTheCardsOwn400(): Promise<void> {
  const secrets = { A: { c: "eA==", iv: "eA==" } };
  let locked: unknown = null;
  const tx = {
    execute: async () => undefined,
    select: () => ({ from: () => ({ where: () => ({ for: () => ({ then: (f: (rows: unknown[]) => unknown) => Promise.resolve(f([locked])) }) }) }) }),
  };
  const tenantDb = { transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) };
  const svc = service(secrets, undefined, tenantDb);
  const hash = draftHash(lastDraft)!;
  locked = { status: "draft", lockReason: null, draft: { ...(lastDraft as object), rtus: [] }, messages: [], checkpoints: null };
  const err = await fail(svc.copy(JWT, SESSION_ID, { from: { rtuIndex: 0 }, toRtuIndexes: [1], draftHash: hash }));
  expect(err).toEqual(new BadRequestException(COPY_PROPOSED_DRAFT_CHANGED));
}
