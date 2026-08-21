import { getEventListeners } from "node:events";

import { sleep } from "./sleep";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export async function runSleepTests(): Promise<void> {
  // ---- resolves after the delay ------------------------------------------------

  const controller = new AbortController();
  const start = Date.now();
  await sleep(20, controller.signal);
  assert(Date.now() - start >= 15, "sleep(20, ...) must not resolve before roughly 20ms have elapsed");

  // ---- resolves early on abort ---------------------------------------------------

  const abortController = new AbortController();
  const abortStart = Date.now();
  const pending = sleep(10_000, abortController.signal);
  abortController.abort();
  await pending;
  assert(
    Date.now() - abortStart < 1000,
    "an aborted sleep must resolve promptly, not wait out its full 10s delay",
  );

  // ---- resolves immediately when the signal is already aborted -------------------

  const preAborted = new AbortController();
  preAborted.abort();
  const alreadyAbortedStart = Date.now();
  await sleep(10_000, preAborted.signal);
  assert(
    Date.now() - alreadyAbortedStart < 100,
    "sleep with an already-aborted signal must resolve immediately, without registering a timer",
  );

  // ---- removes its own abort listener once it resolves, so nothing leaks --------

  const listenerController = new AbortController();
  await sleep(5, listenerController.signal);
  assert(
    getEventListeners(listenerController.signal, "abort").length === 0,
    "sleep must remove its own abort listener once the delay elapses",
  );
}
