import { describe, it } from "vitest";

import {
  assertADeadlineRejectsOneRequestAndLeavesTheSocketUsable,
  assertAReplyForAnOldIdIsDroppedAndTheNextStillResolves,
  assertAReplyFromAnotherUnitIsDropped,
  assertARequestIsAnsweredByItsReply,
  assertASocketCloseRejectsThePendingAndEveryLaterRequest,
  assertAbortDestroysTheSocket,
  assertAnExceptionReplyIsAValueNotAnError,
  assertGarbagePastTheFrameBoundClosesTheSocket,
  assertRequestsNeverOverlap,
  assertTheErrorsCarryNoBytesOrHost,
  assertTheInterRequestDelayIsWaitedBetweenRequests,
  assertTransactionIdsAdvance,
} from "./modbus-transport.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 — the Modbus TCP transport (plan T4.2)", () => {
  it("T1 a request is answered by its reply", async () => {
    await assertARequestIsAnsweredByItsReply();
  });

  it("T2 transaction ids advance", async () => {
    await assertTransactionIdsAdvance();
  });

  it("T3 a reply for an old id is dropped and the next still resolves", async () => {
    await assertAReplyForAnOldIdIsDroppedAndTheNextStillResolves();
  });

  it("T4 a reply from another unit is dropped", async () => {
    await assertAReplyFromAnotherUnitIsDropped();
  });

  it("T5 a deadline rejects one request and leaves the socket usable", async () => {
    await assertADeadlineRejectsOneRequestAndLeavesTheSocketUsable();
  });

  it("T6 a socket close rejects the pending and every later request", async () => {
    await assertASocketCloseRejectsThePendingAndEveryLaterRequest();
  });

  it("T7 abort destroys the socket", async () => {
    await assertAbortDestroysTheSocket();
  });

  it("T8 requests never overlap", async () => {
    await assertRequestsNeverOverlap();
  });

  it("T9 the inter request delay is waited between requests", async () => {
    await assertTheInterRequestDelayIsWaitedBetweenRequests();
  });

  it("T10 garbage past the frame bound closes the socket", async () => {
    await assertGarbagePastTheFrameBoundClosesTheSocket();
  });

  it("T11 an exception reply is a value not an error", async () => {
    await assertAnExceptionReplyIsAValueNotAnError();
  });

  it("T12 the errors carry no bytes or host", async () => {
    await assertTheErrorsCarryNoBytesOrHost();
  });
});
