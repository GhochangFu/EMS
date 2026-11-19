import { expect, vi } from "vitest";

import { fetchLocationDashboard, fetchLocationKpis } from "./locations";

/**
 * `F4.390` — what the location fetchers send. The request carries the query's own abort signal: a
 * read cancelled by an invalidation or by leaving the page must abort its request, or the
 * cancelled read still runs at the server and its answer is discarded.
 */

/** Stub `fetch`, return a getter for the `signal` the request carried. */
function captureSignal(): () => AbortSignal | null | undefined {
  let signal: AbortSignal | null | undefined;
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
    signal = init.signal;
    return new Promise<Response>(() => undefined);
  });
  return () => signal;
}

export async function fetchLocationKpisForwardsTheQuerySignal(): Promise<void> {
  const signalOf = captureSignal();
  const query = new AbortController();
  void fetchLocationKpis(query.signal);
  expect(signalOf()?.aborted, "control: the request signal starts unaborted").toBe(false);
  query.abort();
  expect(signalOf()?.aborted, "aborting the query signal did not abort the request").toBe(true);
}

export async function fetchLocationDashboardForwardsTheQuerySignal(): Promise<void> {
  const signalOf = captureSignal();
  const query = new AbortController();
  void fetchLocationDashboard("22222222-2222-4222-8222-222222222222", undefined, query.signal);
  expect(signalOf()?.aborted, "control: the request signal starts unaborted").toBe(false);
  query.abort();
  expect(signalOf()?.aborted, "aborting the query signal did not abort the request").toBe(true);
}
