import { discoveryJobId, onboardingDiscoveryQueue } from "./onboarding-discovery";
import { JOB_ID_PATTERN, parsePayload, QueuePayloadError } from "./queue-registry";

/**
 * `F3.24b` (ADR 0103 decision 7) — the discovery queue's declaration: a
 * tenant payload that carries no credential, refused field by field.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export const VALID_PAYLOAD = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
  rtuCode: "R1",
  discoveryId: "33333333-3333-4333-8333-333333333333",
  topicPrefix: "Airsprint-1051/Data",
  windowSeconds: 60,
};

/** The refusal's machine-readable reason, by name rather than `instanceof`. */
function reasonOf(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "QueuePayloadError"
    ? (err as QueuePayloadError).reason
    : undefined;
}

function refusalOf(payload: unknown): unknown {
  try {
    parsePayload(onboardingDiscoveryQueue, payload);
  } catch (err) {
    return err;
  }
  return undefined;
}

export function assertValidPayloadParses(): void {
  const parsed = parsePayload(onboardingDiscoveryQueue, VALID_PAYLOAD);
  assert(parsed.discoveryId === VALID_PAYLOAD.discoveryId, "the valid payload must parse unchanged");
}

export function assertPayloadWithoutOrganizationIsRefused(): void {
  const { organizationId: _o, ...rest } = VALID_PAYLOAD;
  const err = refusalOf(rest);
  assert(reasonOf(err) === "invalid_payload", "a payload without organizationId must be refused");
}

export function assertCredentialExtraKeyIsRefused(): void {
  const err = refusalOf({ ...VALID_PAYLOAD, password: "hunter2-hunter2" });
  assert(
    reasonOf(err) === "invalid_payload",
    "a payload with a credential-looking extra key must be refused (the schema is strict)",
  );
}

export function assertWindowAboveMaximumIsRefused(): void {
  const err = refusalOf({ ...VALID_PAYLOAD, windowSeconds: 121 });
  assert(reasonOf(err) === "invalid_payload", "a window of 121 s must be refused");
}

export function assertSingleAttempt(): void {
  assert(
    onboardingDiscoveryQueue.retry.attempts === 1,
    `a failed discovery must not reconnect on retry; attempts=${onboardingDiscoveryQueue.retry.attempts}`,
  );
}

export function assertJobIdMatchesTheGrammar(): void {
  const id = discoveryJobId(VALID_PAYLOAD.discoveryId);
  assert(JOB_ID_PATTERN.test(id), `discoveryJobId must match JOB_ID_PATTERN; got ${id}`);
}
