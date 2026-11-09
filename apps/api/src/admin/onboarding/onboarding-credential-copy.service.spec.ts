import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import {
  COPY_KEY_VERSION,
  COPY_NEEDS_KEY,
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

function service(secrets: Record<string, unknown>, thirdConfig: Record<string, unknown> = { host: "broker.test", port: 8883 }) {
  const draft = {
    rtus: [
      { code: "A", displayName: "A", protocol: "mqtt", config: { host: "broker.test", port: 8883 } },
      { code: "B", displayName: "B", protocol: "mqtt", config: { host: "broker.test", port: 8883 } },
      { code: "C", displayName: "C", protocol: "mqtt", config: thirdConfig },
    ],
    _secrets: secrets,
  };
  const sessions = {
    loadSession: async () => ({ id: SESSION_ID, organizationId: "o1", status: "draft", draft, lockReason: null }),
  };
  // No database: every case below refuses before the write transaction.
  return new OnboardingCredentialCopyService({} as never, {} as never, {} as never, sessions as never);
}

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
