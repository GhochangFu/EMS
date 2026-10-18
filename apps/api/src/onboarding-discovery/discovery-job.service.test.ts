import { describe, it } from "vitest";

import {
  assertBadPortIsRefused,
  assertBlockedHostWritesFailedAndOneRefuseRow,
  assertBrokerErrorIsClassedAndItsTextIsDropped,
  assertClientIdIsTheDiscoveryOne,
  assertCommittedSessionDoesNothing,
  assertCollectorThrowEndsTheWindow,
  assertConnectThrowIsFailedWithAFinishRow,
  assertConnectTimerIsTimeout,
  assertControlCharCredentialIsRefused,
  assertDefaultTransportHandleHasNoPublish,
  assertDoneResultIsStored,
  assertErrorClassOf,
  assertFailedFinishWriteDoesNotThrow,
  assertFinishAuditRowCarriesCounts,
  assertJobConnectsToTheCheckedAddress,
  assertMissingSessionDoesNothing,
  assertNoHostnameKey,
  assertNonMqttRtuFails,
  assertNonQueuedDiscoveryDoesNothing,
  assertNoSecretMeansAnonymous,
  assertNoServernameForAnIpLiteral,
  assertOneSubscriptionToThePrefixWildcard,
  assertOnlyStringCredentialFieldsAreRead,
  assertPhaseAThrowResolvesWithAContinuation,
  assertPhaseAThrowTextIsNotLogged,
  assertPhaseAThrowWritesFailedInTheSecondTransaction,
  assertPhaseAThrowWritesOneFinishRow,
  assertPasswordAppearsNowhere,
  assertProductionConnectOptionsExactly,
  assertProductionProtocolIsMqtts,
  assertRejectedListenIsFailedWithAFinishRow,
  assertRunningIsWrittenBeforeTheWindow,
  assertSubackRefusalIsAuthRefused,
  assertSupersededDiscoveryDoesNothing,
  assertTlsFlagSelectsNothing,
  assertUnreachableHostIsNotARefusal,
  assertUsernameAppearsNowhere,
} from "./discovery-job.service.spec";

/** `F3.24b` (ADR 0103) — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F3.24b — the discovery job", () => {
  describe("connect options (M1, decisions Q5)", () => {
    it("the production options are exactly the expected object", () => assertProductionConnectOptionsExactly());
    it("carry no hostname key", () => assertNoHostnameKey());
    it("send no SNI for an IP literal", () => assertNoServernameForAnIpLiteral());
    it("the production protocol is mqtts", () => assertProductionProtocolIsMqtts());
    it("the job connects to the checked address", () => assertJobConnectsToTheCheckedAddress());
    it("the draft's tls flag selects nothing", () => assertTlsFlagSelectsNothing());
    it("the default transport's handle has no publish", () => assertDefaultTransportHandleHasNoPublish());
  });

  describe("the window", () => {
    it("subscribes once to <prefix>/# at QoS 0", () => assertOneSubscriptionToThePrefixWildcard());
    it("uses client id bms-discovery-<id> and a clean session", () => assertClientIdIsTheDiscoveryOne());
    it("writes running in phase A and connects only after commit", () => assertRunningIsWrittenBeforeTheWindow());
    it("stores the result as done on the second transaction", () => assertDoneResultIsStored());
    it("writes one finish row with the counts", () => assertFinishAuditRowCarriesCounts());
    it("the password appears nowhere but the connect options", () => assertPasswordAppearsNowhere());
    it("the username appears nowhere but the connect options", () => assertUsernameAppearsNowhere());
  });

  describe("guards", () => {
    it("a superseded discovery does nothing", () => assertSupersededDiscoveryDoesNothing());
    it("a discovery no longer queued does nothing", () => assertNonQueuedDiscoveryDoesNothing());
    it("a session RLS hides does nothing", () => assertMissingSessionDoesNothing());
    it("a committed session does nothing", () => assertCommittedSessionDoesNothing());
    it("a blocked host writes failed and one refuse row", () => assertBlockedHostWritesFailedAndOneRefuseRow());
    it("an unreachable host is failed with a finish row, not a refusal", () => assertUnreachableHostIsNotARefusal());
    it("a bad port is refused", () => assertBadPortIsRefused());
    it("a control character in a credential is refused (C1)", () => assertControlCharCredentialIsRefused());
    it("reads only string username and password", () => assertOnlyStringCredentialFieldsAreRead());
    it("no stored credential connects anonymously", () => assertNoSecretMeansAnonymous());
    it("an RTU that is no longer MQTT fails without a connection", () => assertNonMqttRtuFails());
  });

  describe("errors (L1) and the crash path", () => {
    it("classes a broker error and drops its text", () => assertBrokerErrorIsClassedAndItsTextIsDropped());
    it("a transport that throws leaves failed and a finish row", () => assertConnectThrowIsFailedWithAFinishRow());
    it("a rejected listen still leaves failed and a finish row (try/finally)", () => assertRejectedListenIsFailedWithAFinishRow());
    it("a collector throw ends the window as failed", () => assertCollectorThrowEndsTheWindow());
    it("a failed final write does not throw", () => assertFailedFinishWriteDoesNotThrow());
    it("a phase-A throw resolves with a continuation, not a rejection", () => assertPhaseAThrowResolvesWithAContinuation());
    it("a phase-A throw writes failed on the second transaction and never connects", () =>
      assertPhaseAThrowWritesFailedInTheSecondTransaction());
    it("a phase-A throw writes one failed finish row", () => assertPhaseAThrowWritesOneFinishRow());
    it("a phase-A throw's text reaches no log, write or audit row", () => assertPhaseAThrowTextIsNotLogged());
    it("a SUBACK refusal is auth refused", () => assertSubackRefusalIsAuthRefused());
    it("no CONNACK within the bound is timeout", () => assertConnectTimerIsTimeout());
    it("CONNACK code 5 is auth refused", () => assertErrorClassOf({ code: 5, message: "Connection refused: Not authorized" }, "auth refused"));
    it("CONNACK code 4 is auth refused", () => assertErrorClassOf({ code: 4 }, "auth refused"));
    it("MQTT 5 reason 135 is auth refused", () => assertErrorClassOf({ code: 135 }, "auth refused"));
    it("ECONNREFUSED is host unreachable", () => assertErrorClassOf({ code: "ECONNREFUSED" }, "host unreachable"));
    it("EHOSTUNREACH is host unreachable", () => assertErrorClassOf({ code: "EHOSTUNREACH" }, "host unreachable"));
    it("ERR_TLS_CERT_ALTNAME_INVALID is TLS failed", () => assertErrorClassOf({ code: "ERR_TLS_CERT_ALTNAME_INVALID" }, "TLS failed"));
    it("CERT_HAS_EXPIRED is TLS failed", () => assertErrorClassOf({ code: "CERT_HAS_EXPIRED" }, "TLS failed"));
    it("DEPTH_ZERO_SELF_SIGNED_CERT is TLS failed", () => assertErrorClassOf({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" }, "TLS failed"));
    it("ERR_SSL_WRONG_VERSION_NUMBER is TLS failed", () => assertErrorClassOf({ code: "ERR_SSL_WRONG_VERSION_NUMBER" }, "TLS failed"));
    it("an unknown error is host unreachable", () => assertErrorClassOf(new Error("something"), "host unreachable"));
  });
});
