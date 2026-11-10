import { describe, it } from "vitest";

import {
  aBadTokenIs401BeforeTheBody,
  aDeclaredOversizeBodyIs413,
  aFailedWriteIs503WithRetryAfter,
  aGoodBatchIs200,
  aGzipBombIs413AndTheProcessLives,
  aSecondBatchInFlightIs429,
  aTakenPortRejects,
  aReplyWhileClosingSaysConnectionClose,
  aBurstThenSilenceIsStillLogged,
  aKeepAliveClientCannotHoldClose,
  aSilentSocketCannotHoldClose,
  aTricklingClientCannotHoldClose,
  aWriteFailureLogsTheCodeNotTheMessage,
  overTheSampleRateIs429,
  anEmptyBucketIsRefusedBeforeTheBody,
  slowUploadsDoNotHoldTheWriteSlots,
  tooManyInFlightIs429,
  badBodiesAre400WithNoEcho,
  otherMethodsAre405,
  otherPathsAre404,
  refusalsAreThrottled,
  revokedAndDisabledAre403,
} from "./uplink-server.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E7.2 — the uplink listener (ADR 0123 decision 4, plan T3.5)", () => {
  it("answers a good batch 200 with no-store", async () => {
    await aGoodBatchIs200();
  });

  it("answers any other path 404", async () => {
    await otherPathsAre404();
  });

  it("answers GET and other methods 405", async () => {
    await otherMethodsAre405();
  });

  it("answers a bad token 401 before reading the body", async () => {
    await aBadTokenIs401BeforeTheBody();
  });

  it("answers a revoked gateway and a switched-off organization 403", async () => {
    await revokedAndDisabledAre403();
  });

  it("answers a body over the compressed cap 413", async () => {
    await aDeclaredOversizeBodyIs413();
  });

  it("answers a gzip bomb 413 and keeps serving", async () => {
    await aGzipBombIs413AndTheProcessLives();
  });

  it("answers bad encoding, gzip, JSON and schema 400 with no echo", async () => {
    await badBodiesAre400WithNoEcho();
  });

  it("answers a failed write 503 with Retry-After", async () => {
    await aFailedWriteIs503WithRetryAfter();
  });

  it("answers a second batch in flight for one gateway 429", async () => {
    await aSecondBatchInFlightIs429();
  });

  it("logs refusals at most once a minute", async () => {
    await refusalsAreThrottled();
  });

  it("rejects when the port is taken", async () => {
    await aTakenPortRejects();
  });

  it("cannot be held open on close by a silent socket (H1)", async () => {
    await aSilentSocketCannotHoldClose();
  });

  it("cannot be held open on close by a client trickling headers (H1)", async () => {
    await aTricklingClientCannotHoldClose();
  });

  it("cannot be held open on close by a keep-alive client that keeps posting (H1)", async () => {
    await aKeepAliveClientCannotHoldClose();
  });

  it("answers past the in-flight cap 429 overloaded (L1)", async () => {
    await tooManyInFlightIs429();
  });

  it("answers a gateway over its sample rate 429 rate-limited (M2)", async () => {
    await overTheSampleRateIs429();
  });

  it("still logs a burst of refusals followed by silence", async () => {
    await aBurstThenSilenceIsStillLogged();
  });

  it("logs a write failure by class and code, not message", async () => {
    await aWriteFailureLogsTheCodeNotTheMessage();
  });

  it("marks a reply sent while closing Connection: close (H1)", async () => {
    await aReplyWhileClosingSaysConnectionClose();
  });

  it("refuses an empty bucket before reading the body (Low-2)", async () => {
    await anEmptyBucketIsRefusedBeforeTheBody();
  });

  it("does not let four slow uploads hold off a fifth gateway's batch (Low-1)", async () => {
    await slowUploadsDoNotHoldTheWriteSlots();
  });
});
