import { describe, it } from "vitest";

import {
  assertDefaultTimeoutIsFiveSeconds,
  assertProbeClosesTheConnectionAfterATimeout,
  assertProbeDoesNotForwardTheCausesMessage,
  assertProbeNamesTheLastCodedErrorEventWhenTheRejectionHasNoCode,
  assertProbeOpensWithTheParsedConnectionAndTheThreeProbeOptions,
  assertProbeRegistersAnErrorListener,
  assertProbeRejectsNamingTheCauseCodeWhenTheConnectFails,
  assertProbeRejectsWhenPingDoesNotAnswerPong,
  assertProbeRejectsWhenTheClientCannotPing,
  assertProbeRejectsWithinTheTimeoutWhenTheClientNeverSettles,
  assertProbeResolvesOnPong,
} from "./redis-probe.spec";

/**
 * F4.24 (ADR 0063 decision 9) — Vitest entry point for the worker's Redis
 * reachability probe. Assertions live in the sibling `.spec` (§4.6/ADR
 * 0014); this file only runs them.
 */
describe("F4.24 — probeRedis", () => {
  it("resolves on PONG and closes the connection", async () => {
    await assertProbeResolvesOnPong();
  });

  it("opens with the parsed connection plus lazyConnect, maxRetriesPerRequest 1 and enableOfflineQueue false", async () => {
    await assertProbeOpensWithTheParsedConnectionAndTheThreeProbeOptions();
  });

  it("registers one error listener on the probe connection", async () => {
    await assertProbeRegistersAnErrorListener();
  });

  it("rejects with QueueConfigError on the timer when the client never settles", async () => {
    await assertProbeRejectsWithinTheTimeoutWhenTheClientNeverSettles();
  });

  it("closes the still-initialising connection after a timeout", async () => {
    await assertProbeClosesTheConnectionAfterATimeout();
  });

  it("rejects with QueueConfigError naming the cause's code when the connect fails", async () => {
    await assertProbeRejectsNamingTheCauseCodeWhenTheConnectFails();
  });

  it("does not forward the cause's message and still closes", async () => {
    await assertProbeDoesNotForwardTheCausesMessage();
  });

  it("names the code from the last coded error event when the rejection itself has none", async () => {
    await assertProbeNamesTheLastCodedErrorEventWhenTheRejectionHasNoCode();
  });

  it("rejects when PING does not answer PONG, without echoing the reply", async () => {
    await assertProbeRejectsWhenPingDoesNotAnswerPong();
  });

  it("rejects when the client cannot ping", async () => {
    await assertProbeRejectsWhenTheClientCannotPing();
  });

  it("defaults the bound to 5000 ms", () => {
    assertDefaultTimeoutIsFiveSeconds();
  });
});
