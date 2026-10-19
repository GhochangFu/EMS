import { describe, it } from "vitest";

import * as S from "./onboarding-discovery.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.24b U3 — POST sessions/:id/discovery starts one discovery (ADR 0103)", () => {
  it("writes a queued discovery", () => S.aStartWritesAQueuedDiscovery());
  it("audits one start row from the locked row's organization", () => S.aStartAuditsOneStartRowFromTheLockedOrganization());
  it("enqueues the exact payload with the locked row's organization (M4)", () => S.aStartEnqueuesTheExactPayload());
  it("answers the discovery id", () => S.aStartAnswersTheDiscoveryId());
  it("enqueues after the write", () => S.aStartEnqueuesAfterTheWrite());
  it("takes the organization lock before the row lock (M3)", () => S.aStartTakesTheOrganizationLockBeforeTheRowLock());
});

describe("F3.24b U3 — the session gate runs before any refuse row (M5)", () => {
  it("an unknown session writes no refuse row", () => S.anUnknownSessionWritesNoRefuseRow());
  it("a bad prefix is a 400", () => S.aBadPrefixIsA400());
  it("a bad prefix audits a refuse row with no prefix", () => S.aBadPrefixAuditsARefuseRowWithNoPrefix());
  it("the bad-prefix row follows the gate", () => S.aBadPrefixRefuseRowFollowsTheGate());
  it("another body error is a 400 with no audit", () => S.anotherBodyErrorIsA400WithNoAudit());
});

describe("F3.24b U3 — refusals with no audit row", () => {
  it("a committed session is a 403", () => S.aCommittedSessionIsA403WithNoAudit());
  it("a session committed before the lock is a 409", () => S.aSessionCommittedBeforeTheLockIsA409());
  it("an unknown RTU is a 400", () => S.anUnknownRtuIsA400());
  it("a non-MQTT RTU is a 400", () => S.aNonMqttRtuIsA400());
  it("an RTU with no host is a 400 (Q4)", () => S.anRtuWithNoHostIsA400());
  it("an RTU with no port is a 400 (Q4)", () => S.anRtuWithNoPortIsA400());
  it("an RTU with no credentials is a 400", () => S.anRtuWithNoCredentialsIsA400());
});

describe("F3.24b U3 — refusals with a refuse row (decision 9)", () => {
  it("a blocked host is a 400 with a refuse row", () => S.aBlockedHostIsA400WithARefuseRow());
  it("a blocked host is never enqueued", () => S.aBlockedHostIsNeverEnqueued());
  it("a bad port is a 400 with a refuse row", () => S.aBadPortIsA400WithARefuseRow());
  it("an unconfigured queue is a 503 with a refuse row", () => S.anUnconfiguredQueueIsA503WithARefuseRow());
  it("an unconfigured queue stores no discovery", () => S.anUnconfiguredQueueStoresNoDiscovery());
  it("a queued discovery on the session is a 409 (M2)", () => S.aQueuedDiscoveryOnTheSessionIsA409WithARefuseRow());
  it("a running discovery elsewhere in the organization is a 409 (M3)", () =>
    S.aRunningDiscoveryElsewhereInTheOrganizationIsA409());
  it("a stale running discovery elsewhere is not busy", () => S.aStaleRunningDiscoveryElsewhereIsNotBusy());
  it("a finished discovery on the session is not busy", () => S.aFinishedDiscoveryOnTheSessionIsNotBusy());
});

describe("F3.24b U3 — the confirmed target binds the start (H3)", () => {
  it("a changed host is a 409", () => S.aChangedHostIsA409());
  it("a changed port is a 409", () => S.aChangedPortIsA409());
});

describe("F3.24b U3 — an enqueue that fails after the commit", () => {
  it("is a 503", () => S.aFailedEnqueueIsA503());
  it("marks the discovery failed", () => S.aFailedEnqueueMarksTheDiscoveryFailed());
  it("audits a no-worker refusal", () => S.aFailedEnqueueAuditsANoWorkerRefusal());
  it("stores no error text", () => S.aFailedEnqueueStoresNoErrorText());
});

describe("F3.24b U3 — no credential in a row or a payload", () => {
  it("no row or payload carries the ciphertext", () => S.noRowOrPayloadCarriesTheCiphertext());
  it("a credential-shaped host is left out of the row", () => S.aCredentialShapedHostIsLeftOutOfTheRow());
});

describe("F3.24b U3 — the controller", () => {
  it("hands the parsed body to the service", () => S.theRouteHandsTheParsedBodyToTheService());
  it("refuses a bad id before the service", () => S.theRouteRefusesABadIdBeforeTheService());
});
