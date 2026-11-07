import { describe, it } from "vitest";

import {
  assertBlockedHostWinsOverThePlainCheck,
  assertConnectOptionsFollowThePlainChoice,
  assertListedPlainConnectsMqtt,
  assertTheConfirmedTlsChoiceBindsTheJob,
  assertTheListAloneNeverSelectsPlain,
  assertUnlistedPlainIsRefused,
} from "./discovery-job-plaintext.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.326 — discovery follows the plain-MQTT rule (ADR 0114 decision 4)", () => {
  it("J1 refuses an unlisted tls:false RTU as plaintext not allowed", () => assertUnlistedPlainIsRefused());
  it("J2 connects a listed tls:false RTU over mqtt", () => assertListedPlainConnectsMqtt());
  it("J3 never selects plain from the list alone", () => assertTheListAloneNeverSelectsPlain());
  it("J4 runs the host guard first", () => assertBlockedHostWinsOverThePlainCheck());
  it("J6 connects with the TLS choice the user confirmed (review L1)", () => assertTheConfirmedTlsChoiceBindsTheJob());
  it("J5 builds connect options from the plain choice", () => assertConnectOptionsFollowThePlainChoice());
});
